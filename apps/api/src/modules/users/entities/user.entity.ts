import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  OneToMany,
} from 'typeorm';
import { Membership } from '../../memberships/entities/membership.entity';
import { Community } from '../../communities/entities/community.entity';
import { ActivityRecord } from '../../activity/entities/activity-record.entity';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'wallet_address', type: 'text', unique: true, nullable: true })
  walletAddress!: string | null;

  @Column({ type: 'text', nullable: true })
  email!: string | null;

  @Column({ name: 'display_name', type: 'text' })
  displayName!: string;

  @Column({ name: 'user_type', type: 'text' })
  userType!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @OneToMany(() => Membership, (membership) => membership.user)
  memberships!: Membership[];

  @OneToMany(() => Community, (community) => community.operator)
  operatedCommunities!: Community[];

  @OneToMany(() => ActivityRecord, (activity) => activity.member)
  activities!: ActivityRecord[];
}
