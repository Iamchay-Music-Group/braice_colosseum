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

  @Column({ name: 'governance_config', type: 'jsonb' })
  governanceConfig!: Record<string, unknown>;

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
