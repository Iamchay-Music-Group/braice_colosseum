/**
 * Community membership roles.
 *
 * This column was previously a bare `string` that nothing ever read: `join`
 * wrote 'MEMBER', community creation wrote 'OPERATOR', and every authority check
 * compared `communities.operator_id` instead. A role you cannot read and cannot
 * assign is a label, so it is an enum with named values, a documented capability
 * for each tier, and a route that actually assigns it.
 *
 * OPERATOR is a single seat per community, not a tier. `communities.operator_id`
 * holds it, and transferring it moves both the column and the roster row in one
 * transaction. The two are kept in sync rather than treated as two sources of
 * truth: the column is what authority checks read (one comparison, no join),
 * and the membership row is what the roster displays.
 */
export enum MembershipRole {
  /** Can read the roster and request access. The default on join. */
  MEMBER = 'MEMBER',
  /**
   * Can remove ordinary members. Deliberately cannot approve access requests,
   * issue permissions, transfer the operator seat, or touch another moderator —
   * moderation is the one community capability that does not create authority,
   * so it is safe to hand out.
   */
  MODERATOR = 'MODERATOR',
  /** The single seat that can approve, issue, and transfer ownership. */
  OPERATOR = 'OPERATOR',
}

export const MEMBERSHIP_ROLE_VALUES: readonly MembershipRole[] = [
  MembershipRole.MEMBER,
  MembershipRole.MODERATOR,
  MembershipRole.OPERATOR,
];

/**
 * Roles that confer moderation capability.
 *
 * A single list so the removal route checks one thing rather than an `||` chain
 * that a fourth role would silently fall out of.
 */
export const MODERATING_ROLES: readonly string[] = [
  MembershipRole.MODERATOR,
  MembershipRole.OPERATOR,
];