import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { Community } from '../../communities/entities/community.entity';
import { AccessRequest } from '../../access-requests/entities/access-request.entity';
import { Permission } from '../../permissions/entities/permission.entity';

/**
 * Aggregated community intelligence.
 *
 * CRITICAL: this table must never contain member_id, name, email, phone,
 * wallet address, or any individual activity record. It holds only
 * community-level aggregates. The aggregation pipeline is the boundary, and
 * a dataset is therefore always AggregationLevel.COMMUNITY — which is what
 * makes individual data structurally unreachable through a permission.
 */
@Entity('community_datasets')
export class CommunityDataset {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('idx_datasets_community')
  @Column({ name: 'community_id', type: 'uuid' })
  communityId!: string;

  @Column({ name: 'dataset_type', type: 'text' })
  datasetType!: string;

  @Column({ type: 'int' })
  version!: number;

  @Column({ type: 'jsonb' })
  data!: Record<string, unknown>;

  @Column({ name: 'source_count', type: 'int' })
  sourceCount!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @ManyToOne(() => Community, (community) => community.datasets)
  @JoinColumn({ name: 'community_id' })
  community!: Community;

  @OneToMany(() => AccessRequest, (request) => request.dataset)
  accessRequests!: AccessRequest[];

  @OneToMany(() => Permission, (permission) => permission.resource)
  permissions!: Permission[];
}
