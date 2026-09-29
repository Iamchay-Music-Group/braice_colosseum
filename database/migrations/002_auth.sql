-- BRAICE Database Schema
-- Migration 002: Wallet authentication nonces
--
-- Anti-replay state for the wallet sign-in flow:
--   1. POST /api/auth/nonce  -> inserts a row, returns the nonce
--   2. Wallet signs the canonical message with that nonce
--   3. POST /api/auth/verify -> atomically burns the row, returns a JWT
--
-- This is NOT a session store. JWTs are stateless and short-lived.
-- A nonce row exists only to prove a signature was freshly requested and
-- has not been presented before. Rows are pruned by expires_at.

CREATE TABLE IF NOT EXISTS auth_nonces (
  nonce TEXT PRIMARY KEY,
  wallet_address TEXT NOT NULL,
  message TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Lookup path: "is this nonce live?"
CREATE INDEX IF NOT EXISTS idx_auth_nonces_expires ON auth_nonces(expires_at);
CREATE INDEX IF NOT EXISTS idx_auth_nonces_wallet ON auth_nonces(wallet_address);

-- Wallet addresses are case-sensitive in our canonical form (base58), but
-- the column should still reject obviously malformed input upstream.
-- We store the base58 string exactly as verified; see signature.service.ts.
