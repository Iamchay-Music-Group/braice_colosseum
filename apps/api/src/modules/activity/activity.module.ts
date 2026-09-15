// Activity module
// - Imports TypeOrmModule for ActivityRecord entity
// - Provides ActivityService
// - Controllers: ActivityController
//
// CRITICAL: This module handles individual-level activity data.
// The activity endpoint must NEVER be available to brands or AI.
// Only internal/demo ingestion should use this.
