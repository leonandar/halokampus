-- Phase 2: provider message ids (delivery/read status) and survey completion.
ALTER TABLE "messages" ADD COLUMN "provider_message_id" TEXT;
CREATE INDEX "messages_provider_message_id_idx" ON "messages"("provider_message_id");
ALTER TABLE "survey_responses" ADD COLUMN "completed_at" TIMESTAMPTZ, ADD COLUMN "is_dummy" BOOLEAN NOT NULL DEFAULT false;
