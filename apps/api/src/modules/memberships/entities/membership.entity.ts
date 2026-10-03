import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Unique,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Community } from '../../communities/entities/community.entity';
import { MembershipRole } from './membership-role.enum';

@Entity('memberships')
@Unique(['communityId', 'userId'])
export class Membership {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'community_id', type: 'uuid' })
  communityId!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ type: 'text' })
  role!: MembershipRole;

  @Column({ type: 'text' })
  status!: string;

  @CreateDateColumn({ name: 'joined_at', type: 'timestamptz' })
  joinedAt!: Date;

  @ManyToOne(() => Community, (community) => community.memberships)
  @JoinColumn({ name: 'community_id' })
  community!: Community;

  @ManyToOne(() => User, (user) => user.memberships)
  @JoinColumn({ name: 'user_id' })
  user!: User;
}
