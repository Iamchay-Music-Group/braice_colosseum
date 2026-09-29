-- BRAICE Database Schema
-- Migration 003: Email + password account authentication
--
-- Identity moves off-chain. A user account is now an email + password; the
-- Solana wallet becomes an OPTIONAL attribute that exists only so governance
-- decisions can be anchored on-chain (see permissions.principal_id ->
-- users.wallet_address). Holding a wallet grants nothing.
--
--   1. POST /api/auth/register -> creates a MEMBER account, returns a JWT
--   2. POST /api/auth/login    -> verifies the password, returns a JWT
--
-- Onboarding note: accounts created before this migration (by the old wallet
-- sign-in flow) have no password_hash. They cannot log in with a password and
-- must re-register, or have a password set by an operator. The column is
-- therefore NULLable and the login path treats NULL as "password not set"
-- rather than "empty password".

-- --- Password credentials ---------------------------------------------------
-- Nullable: legacy accounts have no password. Never store a plaintext or
-- reversibly-encoded value here — the API stores scrypt digests only
-- (see password.service.ts).
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- --- Brute-force throttling -------------------------------------------------
-- Password login introduces an online guessing surface that wallet signatures
-- did not have. After PASSWORD_MAX_ATTEMPTS consecutive failures the account is
-- locked for PASSWORD_LOCKOUT_SECONDS. Counters reset on any success.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER NOT NULL DEFAULT 0;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;

-- --- Email uniqueness -------------------------------------------------------
-- Emails are the login identifier, so they must be unique. The functional index
-- is on LOWER(email) because addresses are compared case-insensitively; a plain
-- UNIQUE on email would let a@x.com and A@X.com register as separate accounts.
--
-- WHERE email IS NOT NULL is redundant on a unique index (NULLs are already
-- distinct) but makes the intent explicit and keeps the index small.
--
-- Safe on existing data: every pre-migration row has email IS NULL, and
-- NULLs never collide in a btree unique index.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique
  ON users (LOWER(email))
  WHERE email IS NOT NULL;

-- Note: CREATE UNIQUE INDEX is not CONCURRENTLY, so it takes a brief
-- ACCESS EXCLUSIVE lock. The users table is small at this stage of the
-- project. On a large deployment, swap in CREATE UNIQUE INDEX CONCURRENTLY
-- and run it outside a transaction.

-- --- Wallet linking ---------------------------------------------------------
-- wallet_address already exists (001_init.sql) and is already UNIQUE, so the
-- uniqueness guarantee for on-chain grantee accounts is already in place.
-- This migration does not change it.
--
-- A wallet is attached to exactly one account, and attaching one requires
-- proving control of the private key (POST /api/auth/wallet/link). That proof
-- is what stops a user from claiming someone else's address and having a
-- permission anchored to a pubkey they do not control.
