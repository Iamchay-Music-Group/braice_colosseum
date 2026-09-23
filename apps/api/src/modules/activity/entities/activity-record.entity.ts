import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Community } from '../../communities/entities/community.entity';

@Entity('activity_records')
export class ActivityRecord {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'community_id', type: 'uuid' })
  communityId!: string;

  @Column({ name: 'member_id', type: 'uuid' })
  memberId!: string;

  @Column({ name: 'activity_type', type: 'text' })
  activityType!: string;

  @Column({ name: 'interest_category', type: 'text' })
  interestCategory!: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  @Column({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt!: Date;

  @ManyToOne(() => Community, (community) => community.activityRecords)
  @JoinColumn({ name: 'community_id' })
  community!: Community;

  @ManyToOne(() => User, (user) => user.activities)
  @JoinColumn({ name: 'member_id' })
  member!: User;
}
