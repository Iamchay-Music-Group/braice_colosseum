import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Membership } from '../../memberships/entities/membership.entity';
import { ActivityRecord } from '../../activity/entities/activity-record.entity';
import { CommunityDataset } from '../../datasets/entities/community-dataset.entity';
import { AccessRequest } from '../../access-requests/entities/access-request.entity';
import type { GovernanceConfig } from '../../governance/entities/governance-decision.entity';

@Entity('communities')
export class Community {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ name: 'operator_id', type: 'uuid' })
  operatorId!: string;

  /**
   * The rules this community votes by.
   *
   * Typed rather than left as `Record<string, unknown>` because the jsonb column
   * holds exactly one shape, and a column typed as "anything" is a column nothing
   * downstream can check. Both fields are validated on the way in, so this is
   * the type the database actually holds rather than an aspiration.
   */
  @Column({ name: 'governance_config', type: 'jsonb' })
  governanceConfig!: GovernanceConfig;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @ManyToOne(() => User, (user) => user.operatedCommunities)
  @JoinColumn({ name: 'operator_id' })
  operator!: User;

  @OneToMany(() => Membership, (membership) => membership.community)
  memberships!: Membership[];

  @OneToMany(() => ActivityRecord, (activity) => activity.community)
  activityRecords!: ActivityRecord[];

  @OneToMany(() => CommunityDataset, (dataset) => dataset.community)
  datasets!: CommunityDataset[];

  @OneToMany(() => AccessRequest, (request) => request.community)
  accessRequests!: AccessRequest[];
}
