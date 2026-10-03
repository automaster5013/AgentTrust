-- A later rejection must win even when the wall clock moves backwards.
ALTER TABLE agenttrust.run_reviews ADD COLUMN review_order bigint GENERATED ALWAYS AS IDENTITY;
GRANT USAGE ON SEQUENCE agenttrust.run_reviews_review_order_seq TO agenttrust_api;
CREATE INDEX run_review_sequence ON agenttrust.run_reviews(organization_id,project_id,run_id,review_order DESC);
