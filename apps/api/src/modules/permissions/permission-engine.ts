// Permission engine
// CORE HEART OF BRAICE: Evaluates every protected request
//
// checkAccess(input: AccessRequest):
//   1. Identify principal (who is requesting)
//   2. Identify resource (what data)
//   3. Identify requested operation (READ, ANALYZE)
//   4. Find applicable permission
//   5. Verify permission status (must be ACTIVE)
//   6. Verify expiration (must not be expired)
//   7. Verify purpose (must match)
//   8. Verify operation (must be allowed)
//   9. Verify resource scope (must match)
//   10. Verify conditions (allowIndividualData must be false)
//   11. ALLOW or DENY
//
// Pseudo-code:
//   async function authorize(input) {
//     const permission = await findActivePermission(input.principalId, input.resourceId);
//     if (!permission) return deny("NO_PERMISSION");
//     if (permission.status !== "ACTIVE") return deny("PERMISSION_NOT_ACTIVE");
//     if (permission.expiresAt < new Date()) return deny("PERMISSION_EXPIRED");
//     if (!permission.operations.includes(input.operation)) return deny("OPERATION_NOT_ALLOWED");
//     if (permission.purpose !== input.purpose) return deny("PURPOSE_MISMATCH");
//     if (input.requestsIndividualData && !permission.conditions.allowIndividualData) {
//       return deny("INDIVIDUAL_DATA_RESTRICTED");
//     }
//     return allow(permission.id);
//   }
//
// This is the heart of the BRAICE prototype.
