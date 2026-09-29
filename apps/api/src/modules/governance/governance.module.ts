import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GovernanceDecision } from './entities/governance-decision.entity';
import { AccessRequest } from '../access-requests/entities/access-request.entity';
import { Community } from '../communities/entities/community.entity';
import { Membership } from '../memberships/entities/membership.entity';
import { GovernanceService } from './governance.service';
import { GovernanceController } from './governance.controller';
import { PermissionsModule } from '../permissions/permissions.module';
import { AuditModule } from '../audit/audit.module';
import { BlockchainModule } from '../blockchain/blockchain.module';
import { AuthModule } from '../auth/auth.module';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([GovernanceDecision, AccessRequest, Community, Membership]),
    PermissionsModule,
    AuditModule,
    BlockchainModule,
    AuthModule,
  ],
  controllers: [GovernanceController],
  providers: [GovernanceService, JwtAuthGuard],
  exports: [GovernanceService, JwtAuthGuard],
})
export class GovernanceModule {}
