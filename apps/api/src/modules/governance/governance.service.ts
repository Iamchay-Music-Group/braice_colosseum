// Governance service
// Business logic:
// - approve(accessRequestId, approverId) - Record approval
// - reject(accessRequestId, rejectorId) - Record rejection
// - evaluate(accessRequestId) - Check if threshold met
// - getStatus(accessRequestId) - Get current governance status
//
// When governance approves, it triggers permission creation.
