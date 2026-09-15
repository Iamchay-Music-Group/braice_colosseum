-- Test fixtures
-- Data for automated tests

-- Test community
INSERT INTO communities (id, name, operator_id, governance_config) VALUES
('test-community-001', 'Test Community', 'test-creator-001', '{"approval_mode": "CREATOR_AND_THRESHOLD", "threshold_percentage": 60}');

-- Test dataset
INSERT INTO community_datasets (id, community_id, dataset_type, version, data, source_count) VALUES
('test-dataset-001', 'test-community-001', 'interests', 1, '{"streetwear": 42, "music_festivals": 31, "sneakers": 27}', 1000);

-- Test access request
INSERT INTO access_requests (id, community_id, requester_id, dataset_id, purpose, operation, requested_duration_seconds, status) VALUES
('test-request-001', 'test-community-001', 'test-brand-001', 'test-dataset-001', 'campaign_planning', 'ANALYZE', 2592000, 'PENDING');
