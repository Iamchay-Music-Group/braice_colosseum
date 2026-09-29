import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { DatasetsModule } from '../datasets/datasets.module';
import { AuditModule } from '../audit/audit.module';
import { AiGateway } from './ai.gateway';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';

/**
 * The AI module.
 *
 * Note what it does NOT import: TypeOrmModule for Activity, Membership, or
 * User. The module cannot reach the individual-level tables because it never
 * registers them. Data arrives only through AuthorizationService, which will
 * not return a dataset without a passing engine decision. A capability that
 * is absent from the dependency graph cannot be granted by a prompt.
 */
@Module({
  imports: [AuthModule, AuthorizationModule, DatasetsModule, AuditModule],
  controllers: [AiController],
  providers: [AiGateway, AiService],
  // AiService is exported for HealthController only, and only so the health
  // payload can distinguish "no key configured, answering deterministically"
  // from "the AI module is not wired in". It is not exported for reuse: the
  // gateway's data access already goes exclusively through AuthorizationService,
  // and a wider export would make that discipline optional rather than
  // structural.
  exports: [AiService],
})
export class AiModule {}
