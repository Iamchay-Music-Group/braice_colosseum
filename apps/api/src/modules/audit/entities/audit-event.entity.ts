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
  /**
   * A denied AI query. Kept separate from AI_ACCESS_GRANTED rather than
   * inferred from its absence, so a run of failed queries is a queryable
   * pattern and not a hole in the timeline. The `text` column means no
   * migration is required to add it.
   */
  AI_ACCESS_DENIED = 'AI_ACCESS_DENIED',
  AI_ANALYSIS_COMPLETED = 'AI_ANALYSIS_COMPLETED',
  /**
   * An account role or a community membership role changed. Kept separate from
   * the governance events that caused it, because the role change outlives the
   * decision: "who could approve this" and "who is a partner now" are different
   * questions, and collapsing them makes the trail unable to answer the second.
   */
  ROLE_ASSIGNED = 'ROLE_ASSIGNED',
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
