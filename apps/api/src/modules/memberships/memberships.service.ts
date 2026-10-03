import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Membership } from './entities/membership.entity';
import {
  MODERATING_ROLES,
  MembershipRole,
} from './entities/membership-role.enum';
import { Community } from '../communities/entities/community.entity';
import { AuditService } from '../audit/audit.service';
import { AuditEventType } from '../audit/entities/audit-event.entity';

/**
 * Memberships, and the community-ownership checks that gate them.
 *
 * The Community repository is injected here rather than importing
 * CommunitiesService. CommunitiesModule imports this module for the roster
 * routes on its controller, so a dependency the other way would be a module
 * cycle — and the operator check is a single field comparison, not a service
 * worth a cycle over.
 */
@Injectable()
export class MembershipsService {
  constructor(
    @InjectRepository(Membership)
    private readonly membershipRepo: Repository<Membership>,
    @InjectRepository(Community)
    private readonly communityRepo: Repository<Community>,
    private readonly auditService: AuditService,
  ) {}

  async join(communityId: string, userId: string): Promise<Membership> {
    const existing = await this.membershipRepo.findOne({
      where: { communityId, userId },
    });
    if (existing) {
      throw new ConflictException('User is already a member of this community');
    }

    const membership = this.membershipRepo.create({
      communityId,
      userId,
      role: MembershipRole.MEMBER,
      status: 'ACTIVE',
    });

    return this.membershipRepo.save(membership);
  }

  /**
   * Assign a role to an existing member. Operator only.
   *
   * OPERATOR is a transfer, not a promotion. The seat lives in one place —
   * `communities.operator_id` — and every authority check in the system reads
   * that column. Granting OPERATOR without taking it would leave two people
   * able to approve and issue while only one of them could pass an operator
   * check, so the roster would promise authority the service would not honour.
   * Moving it in one transaction also guarantees the failure mode does not
   * exist: there is no interleaving in which the community has two operators, or
   * none, and therefore none in which it becomes impossible to approve anything
   * again.
   *
   * The caller is demoted to MEMBER as part of the transfer rather than being
   * left as a second OPERATOR row. Demotion of the current operator is refused:
   * it is the transfer that is safe, because it names a successor.
   */
  async assignRole(
    communityId: string,
    targetUserId: string,
    role: MembershipRole,
    principalId: string,
  ): Promise<Membership> {
    const community = await this.assertCommunityOperator(communityId, principalId);

    const target = await this.membershipRepo.findOne({
      where: { communityId, userId: targetUserId },
    });
    if (!target) {
      throw new NotFoundException('Membership not found');
    }

    if (role === target.role) {
      // Idempotent for the non-seat roles, where repeating the call changes
      // nothing. The operator seat is exempt: re-assigning it to its current
      // holder looks like a transfer and is not one, and answering it as a
      // success would hide a client that meant to hand it to someone else.
      if (role !== MembershipRole.OPERATOR) {
        return target;
      }
      throw new BadRequestException(
        'You are already the operator of this community',
      );
    }

    if (target.status !== 'ACTIVE') {
      throw new BadRequestException(
        'Only an active member can hold a role in this community',
      );
    }

    if (role === MembershipRole.MEMBER && community.operatorId === targetUserId) {
      throw new BadRequestException(
        'The operator cannot be demoted. Assign OPERATOR to another member to ' +
          'transfer ownership first.',
      );
    }

    // One transaction for the roster row and the seat: half-applied would be
    // worse than either outcome, since the two disagreeing is what every
    // authority check reads.
    await this.membershipRepo.manager.transaction(async (manager: EntityManager) => {
      await manager.update(
        Membership,
        { id: target.id },
        { role },
      );

      if (role === MembershipRole.OPERATOR) {
        await manager.update(
          Membership,
          { communityId, userId: principalId },
          { role: MembershipRole.MEMBER },
        );
        await manager.update(Community, { id: communityId }, { operatorId: targetUserId });
      }
    });

    // Recorded after the transaction commits, so the trail never claims a role
    // change the database refused. Fail-soft for the same reason the governance
    // promotion is: the authority has already moved, and surfacing an error here
    // would tell the operator the transfer failed when it did not.
    await this.auditService.record({
      communityId,
      actorId: principalId,
      eventType: AuditEventType.ROLE_ASSIGNED,
      resourceId: target.id,
      metadata: {
        scope: 'membership',
        userId: targetUserId,
        from: target.role,
        to: role,
        ...(role === MembershipRole.OPERATOR
          ? { transferredFrom: principalId }
          : {}),
      },
    });

    return { ...target, role };
  }

  /**
   * Whether a caller may remove an ordinary member: the operator, or a
   * moderator.
   *
   * Distinct from {@link assertCommunityOperator}, which is the gate on actions
   * that create authority. A moderator can evict someone and cannot approve a
   * request, issue a permission, or hand out the operator seat — which is what
   * makes the tier safe to delegate.
   */
  async canModerate(
    communityId: string,
    principalId: string,
  ): Promise<boolean> {
    if (await this.isCommunityOperator(communityId, principalId)) {
      return true;
    }

    const membership = await this.findActiveMembership(principalId, communityId);

    return membership !== null && MODERATING_ROLES.includes(membership.role);
  }

  /**
   * Leave a community.
   *
   * An operator cannot leave their own community, because leaving is not the
   * same as handing over: nothing names a successor, so the community would be
   * left with nobody able to approve an access request, mint a permission, or
   * anchor a decision on-chain — permanently, and with no route back. Now that
   * `assignRole` exists, the answer names the way out instead of only refusing.
   *
   * Membership removal by an operator is a different route (removeMember) and is
   * unaffected: an operator may remove an ordinary member, just not themselves.
   */
  async leave(communityId: string, userId: string): Promise<void> {
    const community = await this.communityRepo.findOne({
      where: { id: communityId },
    });

    if (!community) {
      throw new NotFoundException('Community not found');
    }

    if (community.operatorId === userId) {
      throw new ForbiddenException(
        'An operator cannot leave their own community. Assign the OPERATOR ' +
          'role to another member first to transfer ownership.',
      );
    }

    const membership = await this.membershipRepo.findOne({
      where: { communityId, userId },
    });
    if (!membership) {
      throw new NotFoundException('Membership not found');
    }
    await this.membershipRepo.remove(membership);
  }

  async findByCommunity(communityId: string): Promise<Membership[]> {
    return this.membershipRepo.find({
      where: { communityId },
      relations: ['user'],
      order: { joinedAt: 'ASC' },
    });
  }

  /**
   * Whether a user is an ACTIVE member of a community.
   *
   * Used as a visibility predicate. Returns a boolean rather than throwing so
   * a caller can distinguish "may read" from "may not" without turning an
   * ordinary authorisation outcome into a 404.
   */
  async isActiveMember(
    userId: string,
    communityId: string,
  ): Promise<boolean> {
    const count = await this.membershipRepo.count({
      where: { userId, communityId, status: 'ACTIVE' },
    });

    return count > 0;
  }

  /**
   * The ACTIVE membership row, or null.
   *
   * Callers verifying a claim about a specific member use this to confirm the
   * claim is true before acting on it, rather than assuming a well-formed id
   * implies a real membership.
   */
  async findActiveMembership(
    userId: string,
    communityId: string,
  ): Promise<Membership | null> {
    return this.membershipRepo.findOne({
      where: { userId, communityId, status: 'ACTIVE' },
    });
  }

  async findByUser(userId: string): Promise<Membership[]> {
    return this.membershipRepo.find({
      where: { userId },
      relations: ['community'],
      order: { joinedAt: 'DESC' },
    });
  }

  async getMemberCount(communityId: string): Promise<number> {
    return this.membershipRepo.count({
      where: { communityId, status: 'ACTIVE' },
    });
  }

  /**
   * Throws unless the community exists.
   *
   * A 404 rather than a 403 for a missing community: "no such community" is the
   * accurate answer and tells the caller nothing about any other community.
   */
  async assertCommunityExists(communityId: string): Promise<Community> {
    const community = await this.communityRepo.findOne({
      where: { id: communityId },
    });

    if (!community) {
      throw new NotFoundException(`Community ${communityId} not found`);
    }

    return community;
  }

  /**
   * Throws unless the caller operates this community.
   *
   * The check is server-side against the verified principal — never against a
   * userId in the request — so a caller cannot assert authority they do not
   * have by naming a different account.
   */
  async assertCommunityOperator(
    communityId: string,
    principalId: string,
  ): Promise<Community> {
    const community = await this.assertCommunityExists(communityId);

    if (community.operatorId !== principalId) {
      throw new ForbiddenException(
        'Only the community operator may perform this action',
      );
    }

    return community;
  }

  /**
   * Whether a caller operates this community. Boolean form of
   * {@link assertCommunityOperator}, for controllers that need the answer rather
   * than the refusal.
   *
   * False for a missing community: a community that does not exist has no
   * operator, and a 404 here would confirm or deny the existence of an id to a
   * caller with no claim on it.
   */
  async isCommunityOperator(
    communityId: string,
    principalId: string,
  ): Promise<boolean> {
    const community = await this.communityRepo.findOne({
      where: { id: communityId },
    });

    return community?.operatorId === principalId;
  }

  /**
   * Whether a caller may read a community's roster: the operator, or a member.
   *
   * Returns a boolean so a controller can choose its own refusal, and returns
   * false for an unresolvable community rather than throwing — a missing
   * community authorises nobody, and a 404 here would distinguish a
   * nonexistent id from a forbidden one for a caller entitled to neither.
   */
  async canViewRoster(
    communityId: string,
    principalId: string,
  ): Promise<boolean> {
    const community = await this.communityRepo.findOne({
      where: { id: communityId },
    });

    if (!community) return false;
    if (community.operatorId === principalId) return true;

    return this.isActiveMember(principalId, communityId);
  }
}
