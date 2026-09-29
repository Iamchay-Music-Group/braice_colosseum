import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { CommunityDataset } from '../../datasets/entities/community-dataset.entity';
import { AccessRequest } from '../../access-requests/entities/access-request.entity';
import { PermissionStatus, Operation } from '../../../common/interfaces/permission.interface';
import type { PermissionConditions } from '@braice/permission-engine';

/**
 * The central BRAICE object.
 *
 * A permission answers WHO, WHAT, WHY, HOW, FOR HOW LONG, and UNDER WHAT
 * CONDITIONS. It is an enforceable policy, not a database flag: it carries a
 * policy hash that anchors it to on-chain state.
 */
@Entity('permissions')
@Index('idx_permissions_lookup', ['principalId', 'resourceId', 'status'])
export class Permission {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'access_request_id', type: 'uuid' })
  accessRequestId!: string;

  @Column({ name: 'principal_id', type: 'uuid' })
  principalId!: string;

  @Column({ name: 'resource_id', type: 'uuid' })
  resourceId!: string;

  @Column({ type: 'text' })
  purpose!: string;

  /**
   * Singular to match the `permissions.operation` column. The original design
   * comment described an `operations` array, but the schema and DTOs are
   * single-valued, so widening it would need a migration for no benefit.
   */
  @Column({ type: 'text' })
  operation!: Operation;

  /**
   * Server-written only. `allowIndividualData` is always false; nothing on a
   * request path can construct a permission that sets it true.
   */
  @Column({ type: 'jsonb', nullable: true })
  conditions!: PermissionConditions;

  @Column({ name: 'issued_at', type: 'timestamptz' })
  issuedAt!: Date;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  @Column({ type: 'text' })
  status!: PermissionStatus;

  /** SHA-256 of the canonical permission JSON; anchors the permission on-chain. */
  @Column({ name: 'policy_hash', type: 'text', nullable: true })
  policyHash!: string | null;

  /** Solana transaction signature. Null when the chain is unavailable. */
  @Column({ name: 'blockchain_reference', type: 'text', nullable: true })
  blockchainReference!: string | null;

  @ManyToOne(() => AccessRequest, (request) => request.permissions)
  @JoinColumn({ name: 'access_request_id' })
  accessRequest!: AccessRequest;

  @ManyToOne(() => User, (user) => user.permissions)
  @JoinColumn({ name: 'principal_id' })
  principal!: User;

  @ManyToOne(() => CommunityDataset, (dataset) => dataset.permissions)
  @JoinColumn({ name: 'resource_id' })
  resource!: CommunityDataset;
}
