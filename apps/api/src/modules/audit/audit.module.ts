import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditEvent } from './entities/audit-event.entity';
import { AuditService } from './audit.service';
import { AuditController } from './audit.controller';
import { Community } from '../communities/entities/community.entity';
import { CommunityDataset } from '../datasets/entities/community-dataset.entity';
import { Permission } from '../permissions/entities/permission.entity';
import { AuthModule } from '../auth/auth.module';

/**
 * The audit trail, and the read-only routes over it.
 *
 * The controller resolves everything it needs through AuditService, so
 * PermissionsModule is intentionally NOT imported here: it imports this module
 * to record revocation events, and a back-reference would be a module cycle.
 */
@Module({
  imports: [
    // Community, CommunityDataset and Permission are loaded here so AuditService
    // can resolve operator ownership and read the permission a trail belongs
    // to, rather than importing PermissionsModule — which already imports this
    // module to write revocation events, so that would be a cycle. A cycle
    // fails at DI time in production, not at compile time, which is why this
    // direction is enforced here rather than discovered.
    TypeOrmModule.forFeature([
      AuditEvent,
      Community,
      CommunityDataset,
      Permission,
    ]),
    // AuthModule exports JwtAuthGuard, which guards both audit routes.
    AuthModule,
  ],
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
