-- Test fixtures
-- Data for automated tests
--
-- IDs are real UUIDs so the columns' UUID types and FK constraints hold.
-- Must be run AFTER 001_init.sql, 002_auth.sql and 003_email_password_auth.sql,
-- and AFTER seed-users.sql (every user referenced below must exist first).
--
-- Test users authenticate with the shared demo password
-- `braice-demo-password-2026` (digest: see seed-users.sql). They carry a
-- wallet_address only so on-chain anchoring has a grantee pubkey to record;
-- the wallet is not a credential.

-- Test creator (operator)
INSERT INTO users (id, email, password_hash, display_name, user_type, wallet_address) VALUES
('11111111-1111-4111-8111-111111111111', 'test-creator@fixtures.braice.local', 'scrypt$32768$8$1$1a0088a05b0ceed067383b42a43da8de$13e3d2ffa3bbb4361dba1a76c5d9c41f2dc034cee356ff6ef09f1c67717139847e32e1a12f41f62dbe84ca7d0b9d4a69ec31e5c6606174b057d1cff763991b81', 'Test Creator', 'CREATOR', 'TestCreatorWallet1111111111111111111111')
ON CONFLICT DO NOTHING;

-- Test partner (requester)
INSERT INTO users (id, email, password_hash, display_name, user_type, wallet_address) VALUES
('22222222-2222-4222-8222-222222222222', 'test-partner@fixtures.braice.local', 'scrypt$32768$8$1$1a0088a05b0ceed067383b42a43da8de$13e3d2ffa3bbb4361dba1a76c5d9c41f2dc034cee356ff6ef09f1c67717139847e32e1a12f41f62dbe84ca7d0b9d4a69ec31e5c6606174b057d1cff763991b81', 'Test Partner', 'PARTNER', 'TestPartnerWallet11111111111111111111111111')
ON CONFLICT DO NOTHING;

-- Test community
INSERT INTO communities (id, name, operator_id, governance_config) VALUES
('33333333-3333-4333-8333-333333333333', 'Test Community', '11111111-1111-4111-8111-111111111111', '{"approval_mode": "CREATOR_AND_THRESHOLD", "threshold_percentage": 60}')
ON CONFLICT (id) DO NOTHING;

-- Test dataset
INSERT INTO community_datasets (id, community_id, dataset_type, version, data, source_count) VALUES
('44444444-4444-4444-8444-444444444444', '33333333-3333-4333-8333-333333333333', 'interests', 1, '{"streetwear": 42, "music_festivals": 31, "sneakers": 27}', 1000)
ON CONFLICT (id) DO NOTHING;

-- Test access request
INSERT INTO access_requests (id, community_id, requester_id, dataset_id, purpose, operation, requested_duration_seconds, status) VALUES
('55555555-5555-4555-8555-555555555555', '33333333-3333-4333-8333-333333333333', '22222222-2222-4222-8222-222222222222', '44444444-4444-4444-8444-444444444444', 'campaign_planning', 'ANALYZE', 2592000, 'PENDING')
ON CONFLICT (id) DO NOTHING;
