// AI gateway
// Ensures AI only accesses data through permission-aware tools
//
// The AI should have:
// - No database credentials
// - No arbitrary SQL tool
// - No generic database query tool
//
// It should have only:
// - get_community_insight()
// - analyze_authorized_dataset()
//
// These tools call the permission engine before receiving any dataset.
