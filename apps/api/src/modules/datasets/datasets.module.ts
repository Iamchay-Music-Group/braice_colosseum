import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommunityDataset } from './entities/community-dataset.entity';
import { ActivityRecord } from '../activity/entities/activity-record.entity';
import { Community } from '../communities/entities/community.entity';
import { DatasetsService } from './datasets.service';
import { DatasetsController } from './datasets.controller';
import { AuthModule } from '../auth/auth.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { MembershipsModule } from '../memberships/memberships.module';

/**
 * Community datasets.
 *
 * AuthorizationModule is imported for the governed GET /datasets/:id route.
 * There is no cycle: AuthorizationModule reaches this service only through
 * AuthorizationService, which injects the CommunityDataset repository
 * directly, and does not import DatasetsModule back.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([CommunityDataset, ActivityRecord, Community]),
    // AuthModule exports JwtAuthGuard, which guards the controller.
    AuthModule,
    AuthorizationModule,
    // For the member check on the dataset listing.
    MembershipsModule,
  ],
  controllers: [DatasetsController],
  providers: [DatasetsService],
  exports: [DatasetsService],
})
export class DatasetsModule {}
