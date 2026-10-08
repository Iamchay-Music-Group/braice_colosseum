import { Test } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';
import { AuditEventType } from './entities/audit-event.entity';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/auth.service';

const OPERATOR = { sub: 'operator-id' } as JwtPayload;
const OTHER = { sub: 'random-partner' } as JwtPayload;
const COMMUNITY = 'community-uuid';
const PERMISSION = 'permission-uuid';
const RESOURCE = 'dataset-uuid';

const LIFECYCLE_EVENTS = [
  AuditEventType.ACCESS_REQUESTED,
  AuditEventType.GOVERNANCE_APPROVED,
  AuditEventType.GOVERNANCE_REJECTED,
  AuditEventType.PERMISSION_CREATED,
  AuditEventType.PERMISSION_REVOKED,
];

describe('AuditController', () => {
  let controller: AuditController;
  let audit: {
    findByCommunity: jest.Mock;
    findByPermission: jest.Mock;
    assertCommunityOperator: jest.Mock;
    isOperatorForResource: jest.Mock;
    findPermission: jest.Mock;
  };

  beforeEach(async () => {
    audit = {
      findByCommunity: jest.fn().mockResolvedValue([]),
      findByPermission: jest.fn().mockResolvedValue([]),
      assertCommunityOperator: jest.fn().mockResolvedValue(undefined),
      isOperatorForResource: jest.fn().mockResolvedValue(false),
      findPermission: jest.fn().mockResolvedValue({
        id: PERMISSION,
        principalId: 'grantee-id',
        resourceId: RESOURCE,
      }),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [AuditController],
      providers: [
        { provide: AuditService, useValue: audit },
      ],
    })
      // The controller is guarded. These tests call the handler directly to
      // exercise the scoping logic, so the guard's own dependency (AuthService)
      // is stubbed out rather than wired — a separate spec covers that an
      // unauthenticated request is refused.
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = moduleRef.get(AuditController);
  });

  describe('GET /communities/:communityId/audit', () => {
    it('asserts the caller operates the community', async () => {
      await controller.findByCommunity(COMMUNITY, OPERATOR);

      expect(audit.assertCommunityOperator).toHaveBeenCalledWith(
        OPERATOR.sub,
        COMMUNITY,
      );
    });

    it('queries by the id from the route, not from a body field', async () => {
      await controller.findByCommunity(COMMUNITY, OPERATOR);

      expect(audit.findByCommunity).toHaveBeenCalledWith(COMMUNITY, 100);
    });

    it('does not read the trail when the operator check refuses', async () => {
      audit.assertCommunityOperator.mockRejectedValue(
        new ForbiddenException('nope'),
      );

      await expect(
        controller.findByCommunity(COMMUNITY, OTHER),
      ).rejects.toThrow(ForbiddenException);

      expect(audit.findByCommunity).not.toHaveBeenCalled();
    });

    it('returns denied attempts along with grants', async () => {
      // No eventTypes argument: the community trail is the unfiltered view.
      await controller.findByCommunity(COMMUNITY, OPERATOR);

      const args = audit.findByCommunity.mock.calls[0];
      expect(args).toHaveLength(2);
    });

    it('defaults to a bounded limit', async () => {
      await controller.findByCommunity(COMMUNITY, OPERATOR, '5000');

      expect(audit.findByCommunity).toHaveBeenCalledWith(COMMUNITY, 500);
    });

    it('falls back to the default for an unparseable limit', async () => {
      await controller.findByCommunity(COMMUNITY, OPERATOR, 'lots');

      expect(audit.findByCommunity).toHaveBeenCalledWith(COMMUNITY, 100);
    });

    it('rejects a negative limit by falling back, not by erroring', async () => {
      await controller.findByCommunity(COMMUNITY, OPERATOR, '-5');

      expect(audit.findByCommunity).toHaveBeenCalledWith(COMMUNITY, 100);
    });
  });

  describe('GET /permissions/:permissionId/audit', () => {
    it('lets the grantee read their own permission', async () => {
      const result = await controller.findByPermission(
        PERMISSION,
        { sub: 'grantee-id' } as JwtPayload,
      );

      expect(result).toEqual([]);
    });

    it('refuses a caller who is neither grantee nor operator', async () => {
      await expect(
        controller.findByPermission(PERMISSION, OTHER),
      ).rejects.toThrow(ForbiddenException);

      expect(audit.findByPermission).not.toHaveBeenCalled();
    });

    it('lets the community operator read the trail', async () => {
      audit.isOperatorForResource.mockResolvedValue(true);

      await controller.findByPermission(PERMISSION, OPERATOR);

      expect(audit.findByPermission).toHaveBeenCalled();
    });

    it('surfaces a missing permission as 404', async () => {
      audit.findPermission.mockResolvedValue(null);

      await expect(
        controller.findByPermission('nope', OPERATOR),
      ).rejects.toThrow(NotFoundException);
    });

    it('gives the grantee only the lifecycle events', async () => {
      // A grantee checking what was decided about them does not need to see
      // the access log, which names other principals' activity.
      await controller.findByPermission(PERMISSION, {
        sub: 'grantee-id',
      } as JwtPayload);

      const options = audit.findByPermission.mock.calls[0][1];
      expect(options.eventTypes).toEqual(LIFECYCLE_EVENTS);
    });

    it('does not expose the access log to the grantee', async () => {
      await controller.findByPermission(PERMISSION, {
        sub: 'grantee-id',
      } as JwtPayload);

      const options = audit.findByPermission.mock.calls[0][1];
      expect(options.eventTypes).not.toContain(AuditEventType.AI_ACCESS_GRANTED);
      expect(options.eventTypes).not.toContain(AuditEventType.ACCESS_GRANTED);
      expect(options.eventTypes).not.toContain(AuditEventType.ACCESS_DENIED);
    });

    it('gives the operator the unfiltered trail', async () => {
      audit.isOperatorForResource.mockResolvedValue(true);

      await controller.findByPermission(PERMISSION, OPERATOR);

      const options = audit.findByPermission.mock.calls[0][1];
      expect(options.eventTypes).toBeUndefined();
    });

    it('gives an operator-who-is-also-grantee the unfiltered trail', async () => {
      audit.findPermission.mockResolvedValue({
        id: PERMISSION,
        principalId: OPERATOR.sub,
        resourceId: RESOURCE,
      });
      audit.isOperatorForResource.mockResolvedValue(true);

      await controller.findByPermission(PERMISSION, OPERATOR);

      const options = audit.findByPermission.mock.calls[0][1];
      expect(options.eventTypes).toBeUndefined();
    });

    it('resolves operator status against the permission resource', async () => {
      await expect(
        controller.findByPermission(PERMISSION, OTHER),
      ).rejects.toThrow(ForbiddenException);

      expect(audit.isOperatorForResource).toHaveBeenCalledWith(
        RESOURCE,
        OTHER.sub,
      );
    });

    it('passes the clamped limit through to the service', async () => {
      audit.isOperatorForResource.mockResolvedValue(true);

      await controller.findByPermission(PERMISSION, OPERATOR, '10');

      expect(audit.findByPermission.mock.calls[0][1].limit).toBe(10);
    });

    it('caps a limit above the ceiling', async () => {
      audit.isOperatorForResource.mockResolvedValue(true);

      await controller.findByPermission(PERMISSION, OPERATOR, '9999');

      expect(audit.findByPermission.mock.calls[0][1].limit).toBe(500);
    });

    it('excludes the access log from the grantee view', async () => {
      // A grant with no lifecycle events yet is normal, and an empty trail is
      // the honest answer for it. This asserts the grantee's view is limited
      // to lifecycle events, not that it is non-empty.
      await controller.findByPermission(PERMISSION, {
        sub: 'grantee-id',
      } as JwtPayload);

      const { eventTypes } = audit.findByPermission.mock.calls[0][1];
      expect(eventTypes).not.toContain(AuditEventType.AI_ANALYSIS_COMPLETED);
    });
  });
});
