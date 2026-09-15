// Activity service
// Business logic:
// - recordActivity(communityId, memberId, type, category, metadata)
// - findByCommunity(communityId) - Get all activity for aggregation
// - findByMember(memberId, communityId) - Get member's activity
// - getActivityCount(communityId) - Count total activities
//
// NOTE: This service is for internal use only.
// External consumers (brands, AI) must use DatasetsModule instead.
