-- Existing reviews remain explicitly unbound; do not invent the policy they approved.
ALTER TABLE stack_reviews ADD COLUMN policy_version VARCHAR(40);
ALTER TABLE stack_reviews ADD COLUMN policy_digest CHAR(71);
ALTER TABLE stack_reviews ADD CONSTRAINT review_policy_pair CHECK ((policy_version IS NULL)=(policy_digest IS NULL));
ALTER TABLE stack_reviews ADD CONSTRAINT review_policy_binding CHECK (
 (policy_version IS NULL AND policy_digest IS NULL) OR
 (policy_version ~ '^[0-9]+\.[0-9]+\.[0-9]+$' AND policy_digest ~ '^sha256:[a-f0-9]{64}$')
);
