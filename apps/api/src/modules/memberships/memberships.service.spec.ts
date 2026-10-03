import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { Repository, ObjectLiteral } from 'typeorm';
import { MembershipsService } from './memberships.service';
import { Membership } from './entities/membership.entity';
import { Community } from '../communities/entities/community.entity';
import { MembershipRole } from './entities/membership-role.enum';
import { AuditService } from '../audit/audit.service';
import { AuditEventType } from '../audit/entities/audit-event.entity';

// 'manager' is omitted from the mapped half: it is an EntityManager on the real
// Repository, and intersecting it with jest.Mock would demand all 27 of its
// methods on a two-field stub.
type MockRepo<T extends ObjectLiteral = any> = Omit<
  Partial<Record<keyof Repository<T>, jest.Mock>>,
  'manager'
> & {
  manager?: MockManager;
};

interface MockManager {
  transaction: jest.Mock;
  update: jest.Mock;
}

const mockRepo = (): MockRepo => ({
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  remove: jest.fn(),
  count: jest.fn(),
  // assignRole moves the roster row and the operator seat inside one
  // transaction, so the tests below assert against the same manager.
  manager: { transaction: jest.fn(), update: jest.fn() },
});

describe('MembershipsService', () => {
  let service: MembershipsService;
  let repo: MockRepo<Membership>;
  let communityRepo: MockRepo<Community>;
  let auditService: { record: jest.Mock };

  beforeEach(async () => {
    // The service resolves community ownership for its operator checks, so
    // both repositories are required to construct it.
    communityRepo = mockRepo();
    auditService = { record: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MembershipsService,
        { provide: getRepositoryToken(Membership), useValue: mockRepo() },
        { provide: getRepositoryToken(Community), useValue: communityRepo },
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();

    service = module.get(MembershipsService);
    repo = module.get(getRepositoryToken(Membership));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('join', () => {
    it('should create a membership', async () => {
      const membership = { id: 'mem-1', communityId: 'comm-1', userId: 'user-1', role: 'MEMBER', status: 'ACTIVE' };

      repo.findOne!.mockResolvedValue(null);
      repo.create!.mockReturnValue(membership);
      repo.save!.mockResolvedValue(membership);

      const result = await service.join('comm-1', 'user-1');

      expect(result).toEqual(membership);
      expect(repo.create).toHaveBeenCalledWith({
        communityId: 'comm-1',
        userId: 'user-1',
        role: 'MEMBER',
        status: 'ACTIVE',
      });
    });

    it('should throw ConflictException on duplicate membership', async () => {
      repo.findOne!.mockResolvedValue({ id: 'existing' });

      await expect(service.join('comm-1', 'user-1')).rejects.toThrow(ConflictException);
    });
  });

  describe('leave', () => {
    it('should remove a membership', async () => {
      // Not the operator: communityRepo answers with a different operatorId.
      communityRepo.findOne!.mockResolvedValue({ id: 'comm-1', operatorId: 'someone-else' });
      const membership = { id: 'mem-1' };
      repo.findOne!.mockResolvedValue(membership);
      repo.remove!.mockResolvedValue(membership);

      await service.leave('comm-1', 'user-1');

      expect(repo.remove).toHaveBeenCalledWith(membership);
    });

    it('should throw NotFoundException for missing membership', async () => {
      communityRepo.findOne!.mockResolvedValue({ id: 'comm-1', operatorId: 'someone-else' });
      repo.findOne!.mockResolvedValue(null);

      await expect(service.leave('comm-1', 'user-1')).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when the community does not exist', async () => {
      communityRepo.findOne!.mockResolvedValue(null);

      await expect(service.leave('comm-1', 'user-1')).rejects.toThrow(NotFoundException);
      expect(repo.remove).not.toHaveBeenCalled();
    });

    it('should refuse to let an operator leave their own community', async () => {
      // Leaving would leave nobody able to approve a request or mint a
      // permission, and there is no ownership-transfer route to undo it.
      communityRepo.findOne!.mockResolvedValue({ id: 'comm-1', operatorId: 'user-1' });
      repo.findOne!.mockResolvedValue({ id: 'mem-1' });

      await expect(service.leave('comm-1', 'user-1')).rejects.toThrow(ForbiddenException);
      expect(repo.remove).not.toHaveBeenCalled();
    });
  });

  describe('findByCommunity', () => {
    it('should return members with user relation', async () => {
      const members = [{ id: '1', communityId: 'comm-1', user: {} }];
      repo.find!.mockResolvedValue(members);

      const result = await service.findByCommunity('comm-1');

      expect(result).toEqual(members);
      expect(repo.find).toHaveBeenCalledWith({
        where: { communityId: 'comm-1' },
        relations: ['user'],
        order: { joinedAt: 'ASC' },
      });
    });
  });

  describe('findByUser', () => {
    it('should return memberships for a user', async () => {
      const memberships = [{ id: '1', userId: 'user-1', community: {} }];
      repo.find!.mockResolvedValue(memberships);

      const result = await service.findByUser('user-1');

      expect(result).toEqual(memberships);
      expect(repo.find).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        relations: ['community'],
        order: { joinedAt: 'DESC' },
      });
    });
  });

  describe('getMemberCount', () => {
    it('should return count of active members', async () => {
      repo.count!.mockResolvedValue(42);

      const result = await service.getMemberCount('comm-1');

      expect(result).toBe(42);
      expect(repo.count).toHaveBeenCalledWith({
        where: { communityId: 'comm-1', status: 'ACTIVE' },
      });
    });
  });
  describe('assignRole', () => {
    const operatorCommunity = { id: 'comm-1', operatorId: 'user-1' };

    // Runs the callback the service hands to manager.transaction, so the
    // assertions see the updates the service actually issues.
    const runTransaction = (): jest.Mock => {
      const manager = repo.manager as MockManager;
      manager.transaction.mockImplementation(async (cb: (m: MockManager) => Promise<void>) =>
        cb(manager),
      );
      return manager.update;
    };

    let update: jest.Mock;

    beforeEach(() => {
      communityRepo.findOne!.mockResolvedValue(operatorCommunity);
      update = runTransaction();
    });

    it('promotes a member to moderator and records who did it', async () => {
      repo.findOne!.mockResolvedValue({
        id: 'mem-2',
        communityId: 'comm-1',
        userId: 'user-2',
        role: MembershipRole.MEMBER,
        status: 'ACTIVE',
      });

      const result = await service.assignRole(
        'comm-1',
        'user-2',
        MembershipRole.MODERATOR,
        'user-1',
      );

      expect(result.role).toBe(MembershipRole.MODERATOR);
      expect(update).toHaveBeenCalledWith(
        Membership,
        { id: 'mem-2' },
        { role: MembershipRole.MODERATOR },
      );
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: AuditEventType.ROLE_ASSIGNED,
          actorId: 'user-1',
          metadata: expect.objectContaining({
            scope: 'membership',
            userId: 'user-2',
            from: MembershipRole.MEMBER,
            to: MembershipRole.MODERATOR,
          }),
        }),
      );
    });

    it('moves the seat and demotes the caller in the same transaction', async () => {
      repo.findOne!.mockResolvedValue({
        id: 'mem-2',
        communityId: 'comm-1',
        userId: 'user-2',
        role: MembershipRole.MEMBER,
        status: 'ACTIVE',
      });

      await service.assignRole(
        'comm-1',
        'user-2',
        MembershipRole.OPERATOR,
        'user-1',
      );

      expect(update).toHaveBeenCalledWith(
        Membership,
        { id: 'mem-2' },
        { role: MembershipRole.OPERATOR },
      );
      expect(update).toHaveBeenCalledWith(
        Membership,
        { communityId: 'comm-1', userId: 'user-1' },
        { role: MembershipRole.MEMBER },
      );
      expect(update).toHaveBeenCalledWith(
        Community,
        { id: 'comm-1' },
        { operatorId: 'user-2' },
      );
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ transferredFrom: 'user-1' }),
        }),
      );
    });

    it('refuses a non-operator', async () => {
      communityRepo.findOne!.mockResolvedValue({ id: 'comm-1', operatorId: 'user-9' });

      await expect(
        service.assignRole('comm-1', 'user-2', MembershipRole.MODERATOR, 'user-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('refuses to demote the sitting operator, who must transfer instead', async () => {
      // Left as a plain MODERATOR row, operator_id would still match, so the
      // community would keep an operator the roster does not show.
      communityRepo.findOne!.mockResolvedValue({ id: 'comm-1', operatorId: 'user-2' });
      repo.findOne!.mockResolvedValue({
        id: 'mem-2',
        userId: 'user-2',
        role: MembershipRole.MODERATOR,
        status: 'ACTIVE',
      });

      await expect(
        service.assignRole('comm-1', 'user-2', MembershipRole.MEMBER, 'user-2'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects re-assigning the seat to its current holder', async () => {
      repo.findOne!.mockResolvedValue({
        id: 'mem-1',
        userId: 'user-1',
        role: MembershipRole.OPERATOR,
        status: 'ACTIVE',
      });

      await expect(
        service.assignRole('comm-1', 'user-1', MembershipRole.OPERATOR, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('treats a repeated moderator role as a no-op', async () => {
      repo.findOne!.mockResolvedValue({
        id: 'mem-2',
        userId: 'user-2',
        role: MembershipRole.MODERATOR,
        status: 'ACTIVE',
      });

      const result = await service.assignRole(
        'comm-1',
        'user-2',
        MembershipRole.MODERATOR,
        'user-1',
      );

      expect(result.role).toBe(MembershipRole.MODERATOR);
      expect(auditService.record).not.toHaveBeenCalled();
    });

    it('refuses a suspended member', async () => {
      repo.findOne!.mockResolvedValue({
        id: 'mem-2',
        userId: 'user-2',
        role: MembershipRole.MEMBER,
        status: 'SUSPENDED',
      });

      await expect(
        service.assignRole('comm-1', 'user-2', MembershipRole.MODERATOR, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('404s a target who is not in the community', async () => {
      repo.findOne!.mockResolvedValue(null);

      await expect(
        service.assignRole('comm-1', 'ghost', MembershipRole.MODERATOR, 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('canModerate', () => {
    it('lets the operator moderate without holding a membership row', async () => {
      // The creator is seeded as an operator without a roster entry, so a
      // membership-only check would lock them out of their own roster.
      communityRepo.findOne!.mockResolvedValue({ id: 'comm-1', operatorId: 'user-1' });

      await expect(service.canModerate('comm-1', 'user-1')).resolves.toBe(true);
      expect(repo.findOne).not.toHaveBeenCalled();
    });

    it('lets a moderator moderate', async () => {
      communityRepo.findOne!.mockResolvedValue({ id: 'comm-1', operatorId: 'user-1' });
      repo.findOne!.mockResolvedValue({ role: MembershipRole.MODERATOR, status: 'ACTIVE' });

      await expect(service.canModerate('comm-1', 'user-2')).resolves.toBe(true);
    });

    it('refuses an ordinary member', async () => {
      communityRepo.findOne!.mockResolvedValue({ id: 'comm-1', operatorId: 'user-1' });
      repo.findOne!.mockResolvedValue({ role: MembershipRole.MEMBER, status: 'ACTIVE' });

      await expect(service.canModerate('comm-1', 'user-2')).resolves.toBe(false);
    });

    it('refuses someone outside the community', async () => {
      communityRepo.findOne!.mockResolvedValue({ id: 'comm-1', operatorId: 'user-1' });
      repo.findOne!.mockResolvedValue(null);

      await expect(service.canModerate('comm-1', 'ghost')).resolves.toBe(false);
    });
  });
});
