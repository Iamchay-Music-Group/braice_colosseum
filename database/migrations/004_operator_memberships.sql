-- BRAICE Database Schema
-- Migration 004: Enrol each community's operator as a member
--
-- Background
-- ----------
-- `POST /api/communities` set `communities.operator_id` from the verified JWT
-- but never wrote a row to `memberships`. So the person running a community was
-- absent from its own roster, `GET /api/communities/:id/members` returned `[]`
-- for them, and the member count read 0.
--
-- That was not merely cosmetic. Every membership-gated route keys off the
-- roster, and the frontend infers "am I a member?" from the roster because the
-- community projection deliberately omits `operatorId`. The visible symptom was
-- a creator being offered a Join button on the community they had just created.
--
-- Fix
-- ---
-- Backfill an ACTIVE OPERATOR membership for every community that lacks one for
-- its operator. Idempotent and safe to re-run.
--
-- Notes on the SQL
-- ----------------
--   * `NOT EXISTS` rather than ON CONFLICT DO NOTHING: the unique index is on
--     (community_id, user_id), but a creator who had *already* joined their own
--     community through the self-service route has a MEMBER row there. Those are
--     left exactly as they are — the operator's identity comes from
--     `communities.operator_id`, not from a role string on a roster row, so
--     upgrading their role would be a cosmetic change that could mislead. The
--     `UPDATE` below handles that case separately and does promote them.
--
-- This is a data backfill, not a schema change: no columns are added, dropped or
-- retyped, so there is nothing to roll back structurally.

-- --- 1. Promote an existing self-joined membership to OPERATOR ---------------
-- A creator who joined their own community before this migration holds a MEMBER
-- row. Their role is corrected here; their status is left alone, so a creator
-- who had somehow been removed stays removed and is not silently reinstated.
UPDATE memberships m
   SET role = 'OPERATOR'
  FROM communities c
 WHERE m.community_id = c.id
   AND m.user_id = c.operator_id
   AND m.role IS DISTINCT FROM 'OPERATOR';

-- --- 2. Enrol operators who have no membership row at all -------------------
INSERT INTO memberships (community_id, user_id, role, status, joined_at)
SELECT c.id, c.operator_id, 'OPERATOR', 'ACTIVE', NOW()
  FROM communities c
 WHERE NOT EXISTS (
         SELECT 1
           FROM memberships m
          WHERE m.community_id = c.id
            AND m.user_id = c.operator_id
       );

-- --- Verify -------------------------------------------------------------------
-- Both counts should be 0 when this finishes.
--
-- SELECT count(*) AS operators_missing_a_membership
--   FROM communities c
--  WHERE NOT EXISTS (SELECT 1 FROM memberships m
--                     WHERE m.community_id = c.id AND m.user_id = c.operator_id);
--
-- SELECT count(*) AS stale_operator_roles
--   FROM memberships m
--   JOIN communities c ON c.id = m.community_id AND c.operator_id = m.user_id
--  WHERE m.role IS DISTINCT FROM 'OPERATOR';