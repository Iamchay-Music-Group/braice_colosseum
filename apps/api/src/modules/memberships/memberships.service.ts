import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Membership } from './entities/membership.entity';
import { Community } from '../communities/entities/community.entity';

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
      role: 'MEMBER',
      status: 'ACTIVE',
    });

    return this.membershipRepo.save(membership);
  }

  /**
   * Leave a community.
   *
   * An operator cannot leave their own community. There is no route to transfer
   * ownership, so allowing it would leave a community with nobody able to
   * approve an access request, mint a permission, or anchor a decision on-chain
   * — permanently, and with no route back. Refusing is the only safe answer
   * until ownership transfer exists; this should become a 409-with-a-transfer-
   * flow rather than a permanent ban the day it does.
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
        'An operator cannot leave their own community',
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
