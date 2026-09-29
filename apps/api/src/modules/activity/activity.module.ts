import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ActivityRecord } from './entities/activity-record.entity';
import { ActivityService } from './activity.service';
import { ActivityController } from './activity.controller';
import { AuthModule } from '../auth/auth.module';
import { CommunitiesModule } from '../communities/communities.module';
import { MembershipsModule } from '../memberships/memberships.module';

/**
 * Individual activity: written by the community operator, never read back over
 * HTTP.
 *
 * ActivityModule exports ActivityService because DatasetsService uses it to
 * aggregate records into a CommunityDataset — the one legitimate consumer of
 * the individual table, and the point where the boundary is crossed.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([ActivityRecord]),
    // AuthModule exports JwtAuthGuard, which guards the controller.
    AuthModule,
    // For the operator check, and MembershipsModule so an ingested memberId is
    // verified against a real ACTIVE membership rather than trusted.
    CommunitiesModule,
    MembershipsModule,
  ],
  controllers: [ActivityController],
  providers: [ActivityService],
  exports: [ActivityService],
})
export class ActivityModule {}
