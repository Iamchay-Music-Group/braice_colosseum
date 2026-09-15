-- Seed activity records
-- 1000 synthetic activity records with realistic distribution
--
-- Distribution:
-- Streetwear: 42% (420 records)
-- Music Festivals: 31% (310 records)
-- Sneakers: 27% (270 records)
-- Beauty: 18% (180 records)
-- Gaming: 15% (150 records)
-- Technology: 12% (120 records)
-- Travel: 9% (90 records)

-- Example records (abbreviated - full seed generates 1000)
INSERT INTO activity_records (id, community_id, member_id, activity_type, interest_category, occurred_at) VALUES
('aa0eebc99-9c0b-4ef8-bb6d-6bb9bd380001', 'e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44', 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380101', 'clicked', 'streetwear', NOW() - INTERVAL '1 day'),
('aa0eebc99-9c0b-4ef8-bb6d-6bb9bd380002', 'e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44', 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380102', 'viewed', 'music_festivals', NOW() - INTERVAL '1 day'),
('aa0eebc99-9c0b-4ef8-bb6d-6bb9bd380003', 'e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44', 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380103', 'purchased', 'sneakers', NOW() - INTERVAL '1 day');
-- Continue for all 1000 records...
