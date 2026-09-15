-- Seed memberships
-- Link users to community

-- Creator as operator
INSERT INTO memberships (id, community_id, user_id, role, status) VALUES
('f0eebc99-9c0b-4ef8-bb6d-6bb9bd380a55', 'e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'OPERATOR', 'ACTIVE');

-- 100 Members
INSERT INTO memberships (id, community_id, user_id, role, status) VALUES
('f0eebc99-9c0b-4ef8-bb6d-6bb9bd380101', 'e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44', 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380101', 'MEMBER', 'ACTIVE'),
('f0eebc99-9c0b-4ef8-bb6d-6bb9bd380102', 'e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44', 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380102', 'MEMBER', 'ACTIVE'),
('f0eebc99-9c0b-4ef8-bb6d-6bb9bd380103', 'e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44', 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380103', 'MEMBER', 'ACTIVE');
-- Continue for all 100 members...
