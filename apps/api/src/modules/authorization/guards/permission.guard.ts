// Permission guard
// NestJS guard for protecting routes
// - Extracts principal from request
// - Calls PermissionEngine.checkAccess()
// - Allows or denies request
// - Used with @UseGuards(PermissionGuard) decorator
