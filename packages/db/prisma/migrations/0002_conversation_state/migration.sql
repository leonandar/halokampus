-- Dialogue state for deterministic flows (verification) and consent-pending message.
ALTER TABLE "conversations" ADD COLUMN "pending_message_id" UUID,
ADD COLUMN "state" JSONB NOT NULL DEFAULT '{}';
