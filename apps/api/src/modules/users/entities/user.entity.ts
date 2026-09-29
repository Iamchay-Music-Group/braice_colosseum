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
import { Permission } from '../../permissions/entities/permission.entity';
import { AccessRequest } from '../../access-requests/entities/access-request.entity';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /**
   * Optional Solana wallet, used ONLY as the on-chain grantee pubkey when a
   * governance decision is anchored (see PermissionsService.anchorPermission).
   *
   * It is not a credential: nothing is authenticated by holding it, and
   * attaching one requires proving control of the private key. Accounts
   * without a wallet simply skip on-chain anchoring.
   */
  @Column({ name: 'wallet_address', type: 'text', unique: true, nullable: true })
  walletAddress!: string | null;

  /**
   * The login identifier. Compared case-insensitively (stored lowercased; the
   * unique index is on LOWER(email)).
   */
  @Column({ type: 'text', nullable: true })
  email!: string | null;

  /**
   * scrypt digest, never a plaintext or reversibly-encoded password.
   *
   * `select: false` is the important part: TypeORM omits the column from every
   * default query, so no service can accidentally serialize a digest through a
   * controller response. The login path opts back in explicitly with
   * `.addSelect('user.passwordHash')`.
   *
   * Nullable because accounts that predate password auth (created by the old
   * wallet flow) have no password. A NULL digest fails verification closed.
   */
  @Column({
    name: 'password_hash',
    type: 'text',
    nullable: true,
    select: false,
  })
  passwordHash!: string | null;

  /**
   * Brute-force counter. `select: false` for the same reason as passwordHash:
   * it is login bookkeeping, not part of a public profile, and the users
   * endpoints return raw rows. Exposing it would tell an attacker how many
   * guesses remain before a target is locked — turning a defence into a
   * targeting tool. `findByEmailForAuth` opts back in.
   */
  @Column({ name: 'failed_login_attempts', type: 'integer', default: 0, select: false })
  failedLoginAttempts!: number;

  /** Active lockout expiry, same `select: false` reasoning as above. */
  @Column({ name: 'locked_until', type: 'timestamptz', nullable: true, select: false })
  lockedUntil!: Date | null;

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

  @OneToMany(() => Permission, (permission) => permission.principal)
  permissions!: Permission[];

  @OneToMany(() => AccessRequest, (request) => request.requester)
  accessRequests!: AccessRequest[];
}
