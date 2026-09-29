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
import { User } from '../../users/entities/user.entity';
import { CommunityDataset } from '../../datasets/entities/community-dataset.entity';
import { GovernanceDecision } from '../../governance/entities/governance-decision.entity';
import { Permission } from '../../permissions/entities/permission.entity';

export enum AccessRequestStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  EXPIRED = 'EXPIRED',
}

/**
 * A brand's request to use a community's aggregated intelligence.
 *
 * A request is a proposal. It becomes enforceable only after governance
 * approves it and a Permission is created from the decision.
 */
@Entity('access_requests')
export class AccessRequest {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('idx_access_requests_community')
  @Column({ name: 'community_id', type: 'uuid' })
  communityId!: string;

  @Index('idx_access_requests_requester')
  @Column({ name: 'requester_id', type: 'uuid' })
  requesterId!: string;

  @Column({ name: 'dataset_id', type: 'uuid' })
  datasetId!: string;

  @Column({ type: 'text' })
  purpose!: string;

  @Column({ type: 'text' })
  operation!: string;

  @Column({ name: 'requested_duration_seconds', type: 'int' })
  requestedDurationSeconds!: number;

  @Column({ type: 'text' })
  status!: AccessRequestStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @ManyToOne(() => Community, (community) => community.accessRequests)
  @JoinColumn({ name: 'community_id' })
  community!: Community;

  @ManyToOne(() => User, (user) => user.accessRequests)
  @JoinColumn({ name: 'requester_id' })
  requester!: User;

  @ManyToOne(() => CommunityDataset, (dataset) => dataset.accessRequests)
  @JoinColumn({ name: 'dataset_id' })
  dataset!: CommunityDataset;

  @OneToMany(() => GovernanceDecision, (decision) => decision.accessRequest)
  governanceDecisions!: GovernanceDecision[];

  @OneToMany(() => Permission, (permission) => permission.accessRequest)
  permissions!: Permission[];
}
