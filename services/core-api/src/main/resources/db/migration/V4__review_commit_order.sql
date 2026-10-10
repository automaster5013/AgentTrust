-- The review advisory lock is acquired before insert. A sequence records insertion order,
-- avoiding transaction-start timestamps reversing the latest decision after lock waits.
ALTER TABLE stack_reviews ADD COLUMN review_sequence BIGINT GENERATED ALWAYS AS IDENTITY;
GRANT USAGE ON SEQUENCE stack_reviews_review_sequence_seq TO agenttrust_stack_api;
CREATE INDEX stack_reviews_order ON stack_reviews(run_id, review_sequence DESC);
