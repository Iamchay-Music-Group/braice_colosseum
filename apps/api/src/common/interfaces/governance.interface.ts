export enum ApprovalMode {
  CREATOR_ONLY = 'CREATOR_ONLY',
  CREATOR_AND_THRESHOLD = 'CREATOR_AND_THRESHOLD',
  THRESHOLD_ONLY = 'THRESHOLD_ONLY',
}

export enum DecisionType {
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

export interface GovernanceConfig {
  approvalMode: ApprovalMode;
  thresholdPercentage: number;
}

export interface GovernanceDecision {
  id: string;
  accessRequestId: string;
  decision: DecisionType;
  approvedBy: string[];
  approvalCount?: number;
  threshold?: number;
  decidedAt: Date;
  blockchainTx?: string;
}
