import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CommunityDataset } from './entities/community-dataset.entity';
import { ActivityRecord } from '../activity/entities/activity-record.entity';
import { Community } from '../communities/entities/community.entity';

@Injectable()
export class DatasetsService {
  private readonly logger = new Logger(DatasetsService.name);

  constructor(
    @InjectRepository(CommunityDataset)
    private readonly datasetRepo: Repository<CommunityDataset>,
    @InjectRepository(ActivityRecord)
    private readonly activityRepo: Repository<ActivityRecord>,
    @InjectRepository(Community)
    private readonly communityRepo: Repository<Community>,
  ) {}

  /**
   * Aggregate a community's individual activity into community intelligence.
   *
   * This is THE DATA BOUNDARY. Only category counts and percentages cross
   * from the individual level to the community level. Member identifiers are
   * never selected, never grouped by, and never written — the query below
   * does not have a member column in its output at all, so there is no code
   * path here that could leak one.
   */
  async generate(communityId: string, datasetType = 'interests'): Promise<CommunityDataset> {
    const community = await this.communityRepo.findOne({ where: { id: communityId } });
    if (!community) {
      throw new NotFoundException(`Community ${communityId} not found`);
    }

    const rows = await this.activityRepo
      .createQueryBuilder('activity')
      .select('activity.interestCategory', 'category')
      .addSelect('COUNT(*)', 'count')
      .where('activity.communityId = :communityId', { communityId })
      .groupBy('activity.interestCategory')
      .orderBy('count', 'DESC')
      .getRawMany<{ category: string; count: string }>();

    const total = rows.reduce((sum, row) => sum + Number(row.count), 0);

    // Percentages only. No ids, no names, no timestamps, no member linkage.
    const data: Record<string, number> = {};
    for (const row of rows) {
      data[row.category] =
        total === 0 ? 0 : Math.round((Number(row.count) / total) * 100);
    }

    const previous = await this.datasetRepo.findOne({
      where: { communityId, datasetType },
      order: { version: 'DESC' },
    });

    const dataset = this.datasetRepo.create({
      communityId,
      datasetType,
      version: (previous?.version ?? 0) + 1,
      data,
      sourceCount: total,
    });

    const saved = await this.datasetRepo.save(dataset);
    this.logger.log(
      `Generated dataset ${saved.id} v${saved.version} for community ${communityId} ` +
        `from ${total} records across ${rows.length} categories`,
    );

    return saved;
  }

  /**
   * A community row, or null.
   *
   * Callers need to distinguish "no such community" from "not your community"
   * to choose their own status code, so this returns null rather than throwing
   * the way findById-adjacent helpers might.
   */
  async findCommunity(communityId: string): Promise<Community | null> {
    return this.communityRepo.findOne({ where: { id: communityId } });
  }

  async findById(id: string): Promise<CommunityDataset> {
    const dataset = await this.datasetRepo.findOne({ where: { id } });
    if (!dataset) {
      throw new NotFoundException(`Dataset ${id} not found`);
    }
    return dataset;
  }

  /** Alias that makes the throwing behaviour explicit at the call site. */
  async requireById(id: string): Promise<CommunityDataset> {
    return this.findById(id);
  }

  /**
   * The community a dataset belongs to, or null.
   *
   * Reads one column instead of the whole row, because the caller uses this to
   * decide who owns the dataset and then hands the read itself to
   * AuthorizationService. A full row loaded here would be a row read before
   * the permission check that decides whether reading it is allowed.
   */
  async findCommunityIdOf(id: string): Promise<string | null> {
    const row = await this.datasetRepo
      .createQueryBuilder('dataset')
      .select('dataset.communityId', 'communityId')
      .where('dataset.id = :id', { id })
      .getRawOne<{ communityId: string } | null>();

    return row?.communityId ?? null;
  }

  async findByCommunity(communityId: string): Promise<CommunityDataset[]> {
    return this.datasetRepo.find({
      where: { communityId },
      order: { version: 'DESC' },
    });
  }
}
