import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessRequest } from './entities/access-request.entity';
import { AccessRequestsService } from './access-requests.service';
import { AccessRequestsController } from './access-requests.controller';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { MembershipsModule } from '../memberships/memberships.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([AccessRequest]),
    // Creating a request writes an ACCESS_REQUESTED event, so the audit trail
    // starts at the ask rather than at the decision.
    AuditModule,
    // AuthModule exports JwtAuthGuard, which guards every route here.
    AuthModule,
    // For the operator check on reads.
    MembershipsModule,
  ],
  controllers: [AccessRequestsController],
  providers: [AccessRequestsService],
  exports: [AccessRequestsService],
})
export class AccessRequestsModule {}
