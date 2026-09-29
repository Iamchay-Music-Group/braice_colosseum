import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { AccessRequest } from '../../access-requests/entities/access-request.entity';

export enum DecisionType {
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

export enum ApprovalMode {
  CREATOR_ONLY = 'CREATOR_ONLY',
  CREATOR_AND_THRESHOLD = 'CREATOR_AND_THRESHOLD',
  THRESHOLD_ONLY = 'THRESHOLD_ONLY',
}

export interface GovernanceConfig {
  approvalMode: ApprovalMode;
  thresholdPercentage: number;
}

/**
 * The recorded outcome of community governance.
 *
 * A decision is the input to permission creation, not a permission itself.
 */
@Entity('governance_decisions')
export class GovernanceDecision {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('idx_governance_access_request')
  @Column({ name: 'access_request_id', type: 'uuid' })
  accessRequestId!: string;

  @Column({ type: 'text' })
  decision!: DecisionType;

  /** Approver wallet addresses, as a JSON array. */
  @Column({ name: 'approved_by', type: 'jsonb' })
  approvedBy!: string[];

  @Column({ name: 'approval_count', type: 'int', nullable: true })
  approvalCount!: number | null;

  @Column({ type: 'int', nullable: true })
  threshold!: number | null;

  @Column({ name: 'decided_at', type: 'timestamptz', default: () => 'NOW()' })
  decidedAt!: Date;

  @Column({ name: 'blockchain_tx', type: 'text', nullable: true })
  blockchainTx!: string | null;

  @ManyToOne(() => AccessRequest, (request) => request.governanceDecisions)
  @JoinColumn({ name: 'access_request_id' })
  accessRequest!: AccessRequest;
}
