import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommunityDataset } from './entities/community-dataset.entity';
import { ActivityRecord } from '../activity/entities/activity-record.entity';
import { Community } from '../communities/entities/community.entity';
import { DatasetsService } from './datasets.service';
import { DatasetsController } from './datasets.controller';

@Module({
  imports: [TypeOrmModule.forFeature([CommunityDataset, ActivityRecord, Community])],
  controllers: [DatasetsController],
  providers: [DatasetsService],
  exports: [DatasetsService],
})
export class DatasetsModule {}
