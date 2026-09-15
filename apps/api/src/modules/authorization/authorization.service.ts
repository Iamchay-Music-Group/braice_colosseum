// Authorization service
// Gateway: receives request -> calls permission engine -> returns decision
//
// authorize(request):
//   1. Validate request format
//   2. Call PermissionEngine.checkAccess()
//   3. Log audit event
//   4. Return AuthorizationDecision
//
// This service ensures all data access goes through the permission engine.
