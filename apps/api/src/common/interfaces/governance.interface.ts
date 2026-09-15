// Governance interfaces
//
// DecisionType: APPROVED, REJECTED
// ApprovalMode: CREATOR_ONLY, CREATOR_AND_THRESHOLD, THRESHOLD_ONLY
//
// GovernanceConfig:
// - approvalMode: how decisions are made
// - thresholdPercentage: community approval threshold
//
// GovernanceDecision:
// - id: unique identifier
// - accessRequestId: related request
// - decision: APPROVED or REJECTED
// - approvedBy: list of approver IDs
// - approvalCount/threshold: voting results
