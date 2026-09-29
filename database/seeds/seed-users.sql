-- Seed users
--
-- Accounts are identified by email + password. The Solana wallet is an
-- optional attribute, present here only so a permission granted to these
-- users can be anchored on-chain. It is not a credential: nothing about
-- holding it grants access.
--
-- Every row below shares the same demo password:
--
--     braice-demo-password-2026
--
-- That is a scrypt digest at the production cost (N = 32768), so the seed
-- exercises the real verification path. It is committed here on purpose, and
-- is why these credentials must never be reused outside a local demo.
--
-- The digest is:
--   scrypt$32768$8$1$1a0088a05b0ceed067383b42a43da8de$13e3d2ff...
--
-- Roles: CREATOR / BRAND / APPLICATION are assigned by governance or an
-- operator tool, never by the person registering. POST /api/auth/register
-- always creates a MEMBER.

-- Creator (Afrobeat Creators community operator)
INSERT INTO users (id, email, password_hash, display_name, user_type, wallet_address) VALUES
('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'creator@demo.braice.local', 'scrypt$32768$8$1$1a0088a05b0ceed067383b42a43da8de$13e3d2ffa3bbb4361dba1a76c5d9c41f2dc034cee356ff6ef09f1c67717139847e32e1a12f41f62dbe84ca7d0b9d4a69ec31e5c6606174b057d1cff763991b81', 'DJ Afrobeat', 'CREATOR', 'CreatorWallet111111111111111111111111111111');

-- Brand (Nike)
INSERT INTO users (id, email, password_hash, display_name, user_type, wallet_address) VALUES
('b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22', 'brand@demo.braice.local', 'scrypt$32768$8$1$1a0088a05b0ceed067383b42a43da8de$13e3d2ffa3bbb4361dba1a76c5d9c41f2dc034cee356ff6ef09f1c67717139847e32e1a12f41f62dbe84ca7d0b9d4a69ec31e5c6606174b057d1cff763991b81', 'Nike', 'BRAND', 'BrandWallet222222222222222222222222222222');

-- AI Agent
INSERT INTO users (id, email, password_hash, display_name, user_type, wallet_address) VALUES
('c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33', 'agent@demo.braice.local', 'scrypt$32768$8$1$1a0088a05b0ceed067383b42a43da8de$13e3d2ffa3bbb4361dba1a76c5d9c41f2dc034cee356ff6ef09f1c67717139847e32e1a12f41f62dbe84ca7d0b9d4a69ec31e5c6606174b057d1cff763991b81', 'BRAICE AI Agent', 'APPLICATION', 'AIAgentWallet33333333333333333333333333333');

-- 100 Members (abbreviated - full seed would generate all 100).
-- Members deliberately have NO wallet: a user who never linked one still gets
-- a fully enforceable permission, it simply is not anchored on-chain.
INSERT INTO users (id, email, password_hash, display_name, user_type, wallet_address) VALUES
('d0eebc99-9c0b-4ef8-bb6d-6bb9bd380101', 'member1@demo.braice.local', 'scrypt$32768$8$1$1a0088a05b0ceed067383b42a43da8de$13e3d2ffa3bbb4361dba1a76c5d9c41f2dc034cee356ff6ef09f1c67717139847e32e1a12f41f62dbe84ca7d0b9d4a69ec31e5c6606174b057d1cff763991b81', 'Member 1', 'MEMBER', NULL),
('d0eebc99-9c0b-4ef8-bb6d-6bb9bd380102', 'member2@demo.braice.local', 'scrypt$32768$8$1$1a0088a05b0ceed067383b42a43da8de$13e3d2ffa3bbb4361dba1a76c5d9c41f2dc034cee356ff6ef09f1c67717139847e32e1a12f41f62dbe84ca7d0b9d4a69ec31e5c6606174b057d1cff763991b81', 'Member 2', 'MEMBER', NULL),
('d0eebc99-9c0b-4ef8-bb6d-6bb9bd380103', 'member3@demo.braice.local', 'scrypt$32768$8$1$1a0088a05b0ceed067383b42a43da8de$13e3d2ffa3bbb4361dba1a76c5d9c41f2dc034cee356ff6ef09f1c67717139847e32e1a12f41f62dbe84ca7d0b9d4a69ec31e5c6606174b057d1cff763991b81', 'Member 3', 'MEMBER', NULL);
-- Continue for all 100 members...
