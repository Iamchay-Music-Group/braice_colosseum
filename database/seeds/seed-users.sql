-- Seed users
-- Creator, Brand, and 100 Members

-- Creator (Afrobeat Creators community operator)
INSERT INTO users (id, wallet_address, display_name, user_type) VALUES
('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'CreatorWallet111111111111111111111111111111', 'DJ Afrobeat', 'CREATOR');

-- Brand (Nike)
INSERT INTO users (id, wallet_address, display_name, user_type) VALUES
('b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22', 'BrandWallet222222222222222222222222222222', 'Nike', 'BRAND');

-- AI Agent
INSERT INTO users (id, wallet_address, display_name, user_type) VALUES
('c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33', 'AIAgentWallet33333333333333333333333333333', 'BRAICE AI Agent', 'APPLICATION');

-- 100 Members (abbreviated - full seed would generate all 100)
INSERT INTO users (id, wallet_address, display_name, user_type) VALUES
('d0eebc99-9c0b-4ef8-bb6d-6bb9bd380101', 'MemberWallet101', 'Member 1', 'INDIVIDUAL'),
('d0eebc99-9c0b-4ef8-bb6d-6bb9bd380102', 'MemberWallet102', 'Member 2', 'INDIVIDUAL'),
('d0eebc99-9c0b-4ef8-bb6d-6bb9bd380103', 'MemberWallet103', 'Member 3', 'INDIVIDUAL');
-- Continue for all 100 members...
