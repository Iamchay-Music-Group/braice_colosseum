// AccessRequests service
// Business logic:
// - createRequest(dto, requesterId) - Create access request
// - findById(id) - Get request with relations
// - findByCommunity(communityId) - List requests for community
// - updateStatus(id, status) - Update request status (PENDING, APPROVED, REJECTED)
//
// The request triggers the governance flow.
