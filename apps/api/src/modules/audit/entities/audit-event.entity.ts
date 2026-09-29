import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
} from 'typeorm';

export enum AuditEventType {
  ACCESS_REQUESTED = 'ACCESS_REQUESTED',
  GOVERNANCE_APPROVED = 'GOVERNANCE_APPROVED',
  GOVERNANCE_REJECTED = 'GOVERNANCE_REJECTED',
  PERMISSION_CREATED = 'PERMISSION_CREATED',
  PERMISSION_REVOKED = 'PERMISSION_REVOKED',
  ACCESS_GRANTED = 'ACCESS_GRANTED',
  ACCESS_DENIED = 'ACCESS_DENIED',
  AI_ACCESS_GRANTED = 'AI_ACCESS_GRANTED',
  AI_ANALYSIS_COMPLETED = 'AI_ANALYSIS_COMPLETED',
}

/**
 * Append-only audit trail.
 *
 * Every authorization decision lands here, allowed or denied. Denials matter
 * as much as grants: a pattern of denied attempts is how an abuse attempt
 * becomes visible.
 */
@Entity('audit_events')
export class AuditEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('idx_audit_community')
  @Column({ name: 'community_id', type: 'uuid', nullable: true })
  communityId!: string | null;

  @Column({ name: 'actor_id', type: 'uuid', nullable: true })
  actorId!: string | null;

  @Index('idx_audit_event_type')
  @Column({ name: 'event_type', type: 'text' })
  eventType!: AuditEventType | string;

  @Column({ name: 'resource_id', type: 'uuid', nullable: true })
  resourceId!: string | null;

  @Column({ name: 'permission_id', type: 'uuid', nullable: true })
  permissionId!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  @Column({ name: 'blockchain_tx', type: 'text', nullable: true })
  blockchainTx!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
