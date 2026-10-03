ALTER TABLE agenttrust.release_receipts ADD COLUMN signature jsonb;
ALTER TABLE agenttrust.release_receipts ADD CONSTRAINT receipt_signature_shape CHECK(signature IS NULL OR
  (jsonb_typeof(signature)='object' AND signature->>'algorithm'='Ed25519'
  AND signature->>'keyId' ~ '^[a-f0-9]{64}$' AND length(signature->>'value')=88));
