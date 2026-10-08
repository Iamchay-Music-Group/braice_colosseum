-- BRAICE Database Schema
-- Migration 005: Rename the `BRAND` account role to `PARTNER`
--
-- Background
-- ----------
-- `user_type` is plain TEXT (001_init.sql) with no CHECK constraint, so the
-- allowed roles live in the API's `CreateUserType` enum and in whatever rows
-- already exist. That enum now says `PARTNER`: the product stopped calling the
-- requester a brand, and the frontend's `USER_TYPES`/`USER_TYPE_LABELS` read
-- `PARTNER` off the wire.
--
-- A row left holding `BRAND` would be an unrecognised role end to end —
-- `asUserType` on the client returns null for it, so the badge renders the
-- explicit "unknown" state, and every role-keyed tone or label falls through.
--
-- Fix
-- ---
-- Rewrite the stored value. Data only: no columns are added, dropped or
-- retyped, so there is nothing to roll back structurally. Idempotent and safe
-- to re-run — a second pass finds no `BRAND` rows and updates nothing.
--
-- The seeds and fixtures were renamed in the same change, so a freshly seeded
-- database never writes `BRAND` at all; this exists for databases seeded
-- before it.

-- --- 1. Rename the role ----------------------------------------------------
UPDATE users
   SET user_type = 'PARTNER'
 WHERE user_type = 'BRAND';

-- --- Verify -------------------------------------------------------------------
-- Should be 0 when this finishes.
--
-- SELECT count(*) AS stale_brand_roles
--   FROM users
--  WHERE user_type = 'BRAND';
