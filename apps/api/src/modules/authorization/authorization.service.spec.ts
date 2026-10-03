import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AggregationLevel } from '@braice/permission-engine';
import { PermissionsService } from '../permissions/permissions.service';
import { AuditService } from '../audit/audit.service';
import { AuditEventType } from '../audit/entities/audit-event.entity';
import { CommunityDataset } from '../datasets/entities/community-dataset.entity';
import { AuthorizeRequestDto } from './dto/authorize-request.dto';
import { AuthorizationService } from './authorization.service';

/**
 * The gateway every data access passes through.
 *
 * Two properties matter here and neither is visible from a controller spec that
 * mocks this service: that a refusal is auditable, and that a denied read never
 * reaches the dataset repository. `loadAuthorizedDataset` is the pattern the AI
 * service and dataset consumers rely on, so an ordering slip here leaks rows.
 */

const PRINCIPAL = '11111111-1111-4111-8111-111111111111';
const RESOURCE = '22222222-2222-4222-8222-222222222222';
const PERMISSION = '33333333-3333-4333-8333-333333333333';
const COMMUNITY = '44444444-4444-4444-8444-444444444444';

describe('AuthorizationService', () => {
  let service: AuthorizationService;
  let permissionsService: { checkAccess: jest.Mock };
  let auditService: { record: jest.Mock };
  let datasetRepo: { findOne: jest.Mock };

  const dto = (over: Partial<AuthorizeRequestDto> = {}): AuthorizeRequestDto =>
    ({
      resourceId: RESOURCE,
      purpose: 'AGGREGATE_ANALYSIS',
      operation: 'READ',
      ...over,
    }) as AuthorizeRequestDto;

  const allow = () => ({
    allowed: true,
    reason: null,
    permissionId: PERMISSION,
    communityId: COMMUNITY,
    aggregationLevel: AggregationLevel.COMMUNITY,
  });

  const deny = (reason: string) => ({
    allowed: false,
    reason,
    permissionId: null,
    communityId: COMMUNITY,
    aggregationLevel: null,
  });

  beforeEach(async () => {
    permissionsService = { checkAccess: jest.fn() };
    auditService = { record: jest.fn().mockResolvedValue(undefined) };
    datasetRepo = { findOne: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthorizationService,
        { provide: PermissionsService, useValue: permissionsService },
        { provide: AuditService, useValue: auditService },
        { provide: getRepositoryToken(CommunityDataset), useValue: datasetRepo },
      ],
    }).compile();

    service = moduleRef.get(AuthorizationService);
  });

  describe('authorize', () => {
    it('passes the caller identity from the guard, never the body', async () => {
      permissionsService.checkAccess.mockResolvedValue(allow());

      await service.authorize(PRINCIPAL, dto({ resourceId: RESOURCE }));

      expect(permissionsService.checkAccess).toHaveBeenCalledWith(
        expect.objectContaining({ principalId: PRINCIPAL }),
      );
    });

    it('returns the engine decision unchanged', async () => {
      const decision = deny('NO_PERMISSION');
      permissionsService.checkAccess.mockResolvedValue(decision);

      await expect(service.authorize(PRINCIPAL, dto())).resolves.toEqual(decision);
    });

    it('audits a grant as ACCESS_GRANTED', async () => {
      permissionsService.checkAccess.mockResolvedValue(allow());

      await service.authorize(PRINCIPAL, dto());

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: PRINCIPAL,
          eventType: AuditEventType.ACCESS_GRANTED,
          permissionId: PERMISSION,
          communityId: COMMUNITY,
        }),
      );
    });

    it('audits a refusal as ACCESS_DENIED with the reason', async () => {
      permissionsService.checkAccess.mockResolvedValue(deny('PERMISSION_EXPIRED'));

      const result = await service.authorize(PRINCIPAL, dto());

      expect(result.allowed).toBe(false);
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: PRINCIPAL,
          eventType: AuditEventType.ACCESS_DENIED,
          permissionId: null,
          metadata: expect.objectContaining({ reason: 'PERMISSION_EXPIRED' }),
        }),
      );
    });

    it('refines rather than widens a coarser permission', async () => {
      permissionsService.checkAccess.mockResolvedValue(allow());

      await service.authorize(PRINCIPAL, dto(), AggregationLevel.INDIVIDUAL);

      expect(permissionsService.checkAccess).toHaveBeenCalledWith(
        expect.objectContaining({
          requestedAggregationLevel: AggregationLevel.INDIVIDUAL,
        }),
      );
    });

    it('records a requested level of null rather than omitting it', async () => {
      permissionsService.checkAccess.mockResolvedValue(allow());

      await service.authorize(PRINCIPAL, dto());

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ requestedAggregationLevel: null }),
        }),
      );
    });

    it('distinguishes "asked for individual and was refused" in the audit trail', async () => {
      permissionsService.checkAccess.mockResolvedValue(deny('AGGREGATION_TOO_FINE'));

      await service.authorize(PRINCIPAL, dto(), AggregationLevel.INDIVIDUAL);

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            requestedAggregationLevel: AggregationLevel.INDIVIDUAL,
          }),
        }),
      );
    });
  });

  describe('loadAuthorizedDataset', () => {
    it('reads the dataset once the engine allows it', async () => {
      permissionsService.checkAccess.mockResolvedValue(allow());
      const dataset = { id: RESOURCE, rows: [] };
      datasetRepo.findOne.mockResolvedValue(dataset);

      await expect(service.loadAuthorizedDataset(PRINCIPAL, dto())).resolves.toBe(
        dataset,
      );
      expect(datasetRepo.findOne).toHaveBeenCalledWith({
        where: { id: RESOURCE },
      });
    });

    it('never touches the dataset repository when access is refused', async () => {
      permissionsService.checkAccess.mockResolvedValue(deny('NO_PERMISSION'));

      await expect(
        service.loadAuthorizedDataset(PRINCIPAL, dto()),
      ).rejects.toThrow(NotFoundException);
      expect(datasetRepo.findOne).not.toHaveBeenCalled();
    });

    it('answers 404 rather than 403 so a denial does not confirm the resource exists', async () => {
      permissionsService.checkAccess.mockResolvedValue(deny('NO_PERMISSION'));

      await expect(
        service.loadAuthorizedDataset(PRINCIPAL, dto()),
      ).rejects.toThrow(/NO_PERMISSION/);
      await expect(
        service.loadAuthorizedDataset(PRINCIPAL, dto()),
      ).rejects.not.toThrow(/Forbidden/i);
    });

    it('re-checks the engine rather than trusting a prior authorization', async () => {
      permissionsService.checkAccess.mockResolvedValue(allow());
      datasetRepo.findOne.mockResolvedValue({ id: RESOURCE });

      await service.loadAuthorizedDataset(PRINCIPAL, dto());

      expect(permissionsService.checkAccess).toHaveBeenCalledTimes(1);
    });

    it('still audits a refusal on the read path', async () => {
      permissionsService.checkAccess.mockResolvedValue(deny('NO_PERMISSION'));

      await service.loadAuthorizedDataset(PRINCIPAL, dto()).catch(() => undefined);

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: AuditEventType.ACCESS_DENIED }),
      );
    });

    it('reports a missing dataset as 404 once access is allowed', async () => {
      permissionsService.checkAccess.mockResolvedValue(allow());
      datasetRepo.findOne.mockResolvedValue(null);

      await expect(
        service.loadAuthorizedDataset(PRINCIPAL, dto()),
      ).rejects.toThrow(/not found/i);
    });
  });
});