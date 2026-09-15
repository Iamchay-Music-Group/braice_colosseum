// Governance engine
// CORE: Converts access requests into decisions
//
// evaluateGovernance(accessRequest, community): GovernanceDecision
//   1. Identify governance rule for community
//   2. Check creator approval
//   3. Check community threshold (e.g., 60%)
//   4. Return decision: APPROVED or REJECTED
//
// The governance decision triggers permission creation.
