import {
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Community } from './entities/community.entity';
import { CreateCommunityDto } from './dto/create-community.dto';
import { Membership } from '../memberships/entities/membership.entity';
import { MembershipRole } from '../memberships/entities/membership-role.enum';
import { BlockchainService } from '../blockchain/blockchain.service';

@Injectable()
export class CommunitiesService {
  private readonly logger = new Logger(CommunitiesService.name);

  constructor(
    @InjectRepository(Community)
    private readonly communityRepo: Repository<Community>,
    private readonly blockchainService: BlockchainService,
  ) {}

  /**
   * Create a community, with its operator as its first member.
   *
   * The operator is enrolled rather than left out of the roster. Two reasons,
   * and the second is the one that matters:
   *
   *   1. It is true. Someone who runs a community is a member of it, and a
   *      community reporting "0 members" while its own operator stands outside
   *      it is simply reporting something false.
   *   2. Every membership-gated route keys off the roster. Leaving the operator
   *      out meant `GET /communities/:id/members` returned an empty list for the
   *      person running the community, the member count read 0, and the UI — which
   *      is built to infer "am I a member" from the roster — offered the creator
   *      a Join button on their own community.
   *
   * The row is written in the same transaction as the community. A community
   * that exists without its operator enrolled is exactly the broken state this
   * is fixing, so it must not be observable even for an instant, and a failed
   * enrol must not leave an orphan behind.
   *
   * The role is OPERATOR, distinct from the MEMBER that a self-service join
   * grants, so ownership is legible from the roster rather than inferred.
   */
  async create(dto: CreateCommunityDto, operatorId: string): Promise<Community> {
    const community = await this.communityRepo.manager.transaction(async (manager: EntityManager) => {
      const community = manager.create(Community, {
        name: dto.name,
        description: dto.description ?? null,
        operatorId,
        governanceConfig: dto.governanceConfig,
      });

      const saved = await manager.save(community);

      await manager.save(
        manager.create(Membership, {
          communityId: saved.id,
          userId: operatorId,
          role: MembershipRole.OPERATOR,
          status: 'ACTIVE',
        }),
      );

      return saved;
    });

    // Outside the transaction, and defensively wrapped, deliberately.
    //
    // The chain write is best-effort and slow (an RPC round trip plus
    // confirmation) while the database write is the thing that must not be
    // rolled back by an unreachable validator. Awaiting it inside the
    // transaction would hold a Postgres transaction open across a network call
    // and let a chain outage abort a community creation that has no on-chain
    // dependency. The community exists either way; only the anchor is optional.
    //
    // BlockchainService is documented never to throw, so this catch is
    // unreachable in principle. It stays because the failure it guards is nasty
    // enough to justify local defence: the community row is already committed, so
    // a 500 would tell the caller their creation failed and invite a retry that
    // creates a duplicate. Depending on a distant class's discipline for that is
    // a bad trade.
    try {
      await this.blockchainService.recordCommunityInitialized({
        communityId: community.id,
        name: community.name,
      });
    } catch (err) {
      this.logger.error(
        `Community ${community.id} was created but could not be anchored: ` +
          `${(err as Error).message}`,
      );
    }

    return community;
  }

  async findById(id: string): Promise<Community> {
    const community = await this.communityRepo.findOne({
      where: { id },
      relations: ['operator', 'memberships'],
    });
    if (!community) {
      throw new NotFoundException(`Community ${id} not found`);
    }
    return community;
  }

  async findByOperator(operatorId: string): Promise<Community[]> {
    return this.communityRepo.find({
      where: { operatorId },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * A community row, or null.
   *
   * Distinct from findById, which throws. Callers that need to decide between
   * "not found" and "not yours" use this so they can apply their own policy to
   * a missing community, instead of inheriting a 404 from a shared helper.
   */
  async findByIdOrNull(id: string): Promise<Community | null> {
    return this.communityRepo.findOne({ where: { id } });
  }

  async findAll(): Promise<Community[]> {
    return this.communityRepo.find({
      relations: ['operator'],
      order: { createdAt: 'DESC' },
    });
  }
}
