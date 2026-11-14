-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateTable
CREATE TABLE "roles" (
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "totp_secret_enc" TEXT,
    "totp_enabled" BOOLEAN NOT NULL DEFAULT false,
    "role_code" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "presence" TEXT NOT NULL DEFAULT 'offline',
    "failed_logins" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ,
    "is_dummy" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_sessions" (
    "id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "csrf_token" TEXT NOT NULL,
    "two_factor_ok" BOOLEAN NOT NULL DEFAULT false,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "presence_logs" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "presence_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channels" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "capabilities" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "ai_paused" BOOLEAN NOT NULL DEFAULT false,
    "ai_paused_reason" TEXT,
    "ai_paused_by" UUID,
    "ai_paused_at" TIMESTAMPTZ,
    "config_enc" TEXT,

    CONSTRAINT "channels_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "pseudo_id" UUID NOT NULL,
    "display_name_enc" TEXT,
    "reg_no_enc" TEXT,
    "reg_no_bidx" TEXT,
    "contact_email_enc" TEXT,
    "contact_phone_enc" TEXT,
    "program_code" TEXT,
    "admission_path" TEXT,
    "stage" TEXT,
    "verified_at" TIMESTAMPTZ,
    "anonymized_at" TIMESTAMPTZ,
    "is_dummy" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_identities" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "channel_code" TEXT NOT NULL,
    "external_id_enc" TEXT NOT NULL,
    "external_id_bidx" TEXT NOT NULL,
    "verified_at" TIMESTAMPTZ,
    "linked_consent_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_sessions" (
    "id" TEXT NOT NULL,
    "customer_id" UUID NOT NULL,
    "channel_code" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT 'chat',
    "expires_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consents" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "purpose" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "notice_version" TEXT NOT NULL,
    "channel_code" TEXT NOT NULL,
    "granted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "withdrawn_at" TIMESTAMPTZ,

    CONSTRAINT "consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otps" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "consumed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "channel_code" TEXT NOT NULL,
    "identity_id" UUID,
    "ticket_id" UUID,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_activity_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "ticket_id" UUID,
    "sender_type" TEXT NOT NULL,
    "sender_user_id" UUID,
    "kind" TEXT NOT NULL DEFAULT 'text',
    "body_enc" TEXT NOT NULL,
    "meta" JSONB NOT NULL DEFAULT '{}',
    "ai_action_id" UUID,
    "delivery_status" TEXT NOT NULL DEFAULT 'sent',
    "retracted" BOOLEAN NOT NULL DEFAULT false,
    "is_dummy" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tickets" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "customer_id" UUID NOT NULL,
    "tier" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "mandatory_category" BOOLEAN NOT NULL DEFAULT false,
    "arrival_reason" TEXT,
    "last_confidence" DECIMAL(5,4),
    "negative_feedback_streak" INTEGER NOT NULL DEFAULT 0,
    "assigned_user_id" UUID,
    "last_channel_code" TEXT NOT NULL,
    "summary_enc" TEXT,
    "opened_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "first_response_at" TIMESTAMPTZ,
    "first_human_response_at" TIMESTAMPTZ,
    "resolved_at" TIMESTAMPTZ,
    "closed_at" TIMESTAMPTZ,
    "reopen_count" INTEGER NOT NULL DEFAULT 0,
    "is_dummy" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_assignments" (
    "id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "tier" TEXT NOT NULL,
    "claimed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "released_at" TIMESTAMPTZ,

    CONSTRAINT "ticket_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "escalations" (
    "id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "from_tier" TEXT NOT NULL,
    "to_tier" TEXT NOT NULL,
    "reason_code" TEXT NOT NULL,
    "reason_note" TEXT,
    "handoff_enc" TEXT,
    "confidence" DECIMAL(5,4),
    "actor_type" TEXT NOT NULL,
    "actor_user_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "escalations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sla_policies" (
    "id" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "category" TEXT,
    "param_code" TEXT NOT NULL,

    CONSTRAINT "sla_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sla_timers" (
    "id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "tier" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "param_code" TEXT NOT NULL,
    "policy_version" INTEGER NOT NULL,
    "trigger_at" TIMESTAMPTZ NOT NULL,
    "starts_at" TIMESTAMPTZ NOT NULL,
    "deadline_at" TIMESTAMPTZ NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'running',
    "settled_at" TIMESTAMPTZ,

    CONSTRAINT "sla_timers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_actions" (
    "id" UUID NOT NULL,
    "ticket_id" UUID,
    "inbound_message_id" UUID,
    "agent" TEXT NOT NULL,
    "action_type" TEXT NOT NULL,
    "authority_class" TEXT NOT NULL,
    "category" TEXT,
    "confidence" DECIMAL(5,4),
    "confidence_components" JSONB NOT NULL DEFAULT '{}',
    "citations" JSONB NOT NULL DEFAULT '[]',
    "guard" JSONB NOT NULL DEFAULT '{}',
    "routing" JSONB NOT NULL DEFAULT '{}',
    "outcome" TEXT NOT NULL,
    "output_enc" TEXT,
    "provider" TEXT,
    "model" TEXT,
    "location" TEXT,
    "latency_ms" INTEGER,
    "policy_versions" JSONB NOT NULL DEFAULT '{}',
    "channel_code" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "overrides" (
    "id" UUID NOT NULL,
    "ai_action_id" UUID NOT NULL,
    "staff_user_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "cause_category" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "replacement_enc" TEXT,
    "notify_customer" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "seq" BIGSERIAL NOT NULL,
    "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_type" TEXT NOT NULL,
    "actor_id" TEXT,
    "actor_role" TEXT,
    "action" TEXT NOT NULL,
    "resource_type" TEXT,
    "resource_id" TEXT,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "prev_hash" TEXT NOT NULL,
    "hash" TEXT NOT NULL,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("seq")
);

-- CreateTable
CREATE TABLE "events" (
    "seq" BIGSERIAL NOT NULL,
    "occurred_at" TIMESTAMPTZ NOT NULL,
    "type" TEXT NOT NULL,
    "ticket_id" UUID,
    "conversation_id" UUID,
    "customer_pseudo_id" UUID,
    "channel" TEXT,
    "tier" TEXT,
    "category" TEXT,
    "actor_type" TEXT,
    "actor_id" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "policy_versions" JSONB NOT NULL DEFAULT '{}',
    "is_dummy" BOOLEAN NOT NULL DEFAULT false,
    "prev_hash" TEXT NOT NULL,
    "hash" TEXT NOT NULL,

    CONSTRAINT "events_pkey" PRIMARY KEY ("seq")
);

-- CreateTable
CREATE TABLE "kb_documents" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "effective_from" DATE,
    "effective_to" DATE,
    "scope" JSONB NOT NULL DEFAULT '{}',
    "source_text" TEXT NOT NULL,
    "embedding_model" TEXT NOT NULL,
    "test_report" JSONB,
    "tested_at" TIMESTAMPTZ,
    "tested_by" UUID,
    "published_at" TIMESTAMPTZ,
    "published_by" UUID,
    "created_by" UUID,
    "is_dummy" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kb_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kb_chunks" (
    "id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "ord" INTEGER NOT NULL,
    "section" TEXT NOT NULL,
    "scope" JSONB NOT NULL DEFAULT '{}',
    "content" TEXT NOT NULL,
    "embedding" vector,

    CONSTRAINT "kb_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policy_parameters" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "value" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "reason" TEXT,
    "effective_from" TIMESTAMPTZ,
    "proposed_by" UUID,
    "proposed_role" TEXT,
    "approved_by" UUID,
    "approved_role" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "policy_parameters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_authority_rules" (
    "id" UUID NOT NULL,
    "action_key" TEXT NOT NULL,
    "authority_class" TEXT NOT NULL,
    "description" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ai_authority_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_subject_requests" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "detail_enc" TEXT,
    "due_at" TIMESTAMPTZ,
    "ticket_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMPTZ,

    CONSTRAINT "data_subject_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "surveys" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "source_file" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "surveys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "survey_responses" (
    "id" UUID NOT NULL,
    "survey_id" UUID NOT NULL,
    "ticket_id" UUID,
    "channel_code" TEXT NOT NULL,
    "answers" JSONB NOT NULL,
    "answered_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "survey_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qa_reviews" (
    "id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "reviewer_id" UUID NOT NULL,
    "form_version" TEXT NOT NULL,
    "scores" JSONB NOT NULL,
    "ai_answer_correct" BOOLEAN,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qa_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orchestration_cycles" (
    "id" UUID NOT NULL,
    "cadence" TEXT NOT NULL,
    "period_start" DATE NOT NULL,
    "checklist" JSONB NOT NULL,
    "owner_id" UUID,
    "closed_at" TIMESTAMPTZ,

    CONSTRAINT "orchestration_cycles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sim_outbox" (
    "id" UUID NOT NULL,
    "channel_code" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sim_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "presence_logs_user_id_at_idx" ON "presence_logs"("user_id", "at");

-- CreateIndex
CREATE UNIQUE INDEX "customers_pseudo_id_key" ON "customers"("pseudo_id");

-- CreateIndex
CREATE UNIQUE INDEX "customers_reg_no_bidx_key" ON "customers"("reg_no_bidx");

-- CreateIndex
CREATE UNIQUE INDEX "customer_identities_channel_code_external_id_bidx_key" ON "customer_identities"("channel_code", "external_id_bidx");

-- CreateIndex
CREATE INDEX "customer_sessions_customer_id_idx" ON "customer_sessions"("customer_id");

-- CreateIndex
CREATE INDEX "consents_customer_id_purpose_idx" ON "consents"("customer_id", "purpose");

-- CreateIndex
CREATE INDEX "conversations_customer_id_idx" ON "conversations"("customer_id");

-- CreateIndex
CREATE INDEX "messages_conversation_id_created_at_idx" ON "messages"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "messages_ticket_id_created_at_idx" ON "messages"("ticket_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "tickets_number_key" ON "tickets"("number");

-- CreateIndex
CREATE INDEX "tickets_status_tier_idx" ON "tickets"("status", "tier");

-- CreateIndex
CREATE INDEX "tickets_customer_id_idx" ON "tickets"("customer_id");

-- CreateIndex
CREATE INDEX "ticket_assignments_ticket_id_idx" ON "ticket_assignments"("ticket_id");

-- CreateIndex
CREATE INDEX "escalations_ticket_id_idx" ON "escalations"("ticket_id");

-- CreateIndex
CREATE INDEX "sla_timers_state_deadline_at_idx" ON "sla_timers"("state", "deadline_at");

-- CreateIndex
CREATE INDEX "sla_timers_ticket_id_idx" ON "sla_timers"("ticket_id");

-- CreateIndex
CREATE INDEX "ai_actions_created_at_idx" ON "ai_actions"("created_at");

-- CreateIndex
CREATE INDEX "ai_actions_ticket_id_idx" ON "ai_actions"("ticket_id");

-- CreateIndex
CREATE UNIQUE INDEX "audit_logs_hash_key" ON "audit_logs"("hash");

-- CreateIndex
CREATE INDEX "audit_logs_resource_type_resource_id_idx" ON "audit_logs"("resource_type", "resource_id");

-- CreateIndex
CREATE INDEX "audit_logs_at_idx" ON "audit_logs"("at");

-- CreateIndex
CREATE UNIQUE INDEX "events_hash_key" ON "events"("hash");

-- CreateIndex
CREATE INDEX "events_type_occurred_at_idx" ON "events"("type", "occurred_at");

-- CreateIndex
CREATE INDEX "events_ticket_id_idx" ON "events"("ticket_id");

-- CreateIndex
CREATE UNIQUE INDEX "kb_documents_slug_version_key" ON "kb_documents"("slug", "version");

-- CreateIndex
CREATE INDEX "kb_chunks_document_id_idx" ON "kb_chunks"("document_id");

-- CreateIndex
CREATE INDEX "policy_parameters_code_status_idx" ON "policy_parameters"("code", "status");

-- CreateIndex
CREATE UNIQUE INDEX "policy_parameters_code_version_key" ON "policy_parameters"("code", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ai_authority_rules_action_key_version_key" ON "ai_authority_rules"("action_key", "version");

-- CreateIndex
CREATE UNIQUE INDEX "surveys_code_key" ON "surveys"("code");

-- CreateIndex
CREATE INDEX "sim_outbox_channel_code_recipient_created_at_idx" ON "sim_outbox"("channel_code", "recipient", "created_at");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_role_code_fkey" FOREIGN KEY ("role_code") REFERENCES "roles"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_sessions" ADD CONSTRAINT "staff_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "presence_logs" ADD CONSTRAINT "presence_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_identities" ADD CONSTRAINT "customer_identities_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consents" ADD CONSTRAINT "consents_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "otps" ADD CONSTRAINT "otps_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_assignments" ADD CONSTRAINT "ticket_assignments_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_assignments" ADD CONSTRAINT "ticket_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escalations" ADD CONSTRAINT "escalations_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sla_timers" ADD CONSTRAINT "sla_timers_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_actions" ADD CONSTRAINT "ai_actions_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "overrides" ADD CONSTRAINT "overrides_ai_action_id_fkey" FOREIGN KEY ("ai_action_id") REFERENCES "ai_actions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "overrides" ADD CONSTRAINT "overrides_staff_user_id_fkey" FOREIGN KEY ("staff_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kb_chunks" ADD CONSTRAINT "kb_chunks_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "kb_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_subject_requests" ADD CONSTRAINT "data_subject_requests_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "survey_responses" ADD CONSTRAINT "survey_responses_survey_id_fkey" FOREIGN KEY ("survey_id") REFERENCES "surveys"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ===================================================================== haloK@MPUS custom SQL
-- Append-only enforcement for audit_logs and events (NFR-08, FR-32). TRUNCATE is still
-- possible for a DB owner (used only by the test suite); the hash chain makes any
-- out-of-band change detectable via `pnpm audit:verify`.
CREATE OR REPLACE FUNCTION hk_reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'table % is append-only', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION hk_reject_mutation();
CREATE TRIGGER events_append_only BEFORE UPDATE OR DELETE ON "events"
  FOR EACH ROW EXECUTE FUNCTION hk_reject_mutation();

-- Full-text column for hybrid retrieval. 'simple' config: PostgreSQL has no Indonesian stemmer.
ALTER TABLE "kb_chunks" ADD COLUMN "tsv" tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', coalesce("section", '') || ' ' || coalesce("content", ''))) STORED;
CREATE INDEX "kb_chunks_tsv_idx" ON "kb_chunks" USING GIN ("tsv");

-- Reference data
INSERT INTO "roles" ("code", "label") VALUES
  ('cp', 'Mahasiswa CP'), ('staff', 'Staf PMB'), ('leader', 'Pimpinan PMB'),
  ('finance', 'Unit Keuangan'), ('admin', 'Admin TI');

INSERT INTO "channels" ("code", "name", "capabilities", "enabled") VALUES
  ('web', 'Web chat', '{"attachments":true,"buttons":true,"readReceipts":true,"maxTextLength":4000}', true),
  ('whatsapp', 'WhatsApp', '{"attachments":true,"buttons":true,"readReceipts":true,"maxTextLength":4096}', true),
  ('instagram', 'Instagram DM', '{"attachments":true,"buttons":false,"readReceipts":true,"maxTextLength":1000}', false),
  ('messenger', 'Facebook Messenger', '{"attachments":true,"buttons":true,"readReceipts":true,"maxTextLength":2000}', false),
  ('email', 'Email', '{"attachments":true,"buttons":false,"readReceipts":false,"maxTextLength":100000}', false),
  ('telegram', 'Telegram', '{"attachments":true,"buttons":true,"readReceipts":false,"maxTextLength":4096}', false),
  ('phone', 'Pencatatan telepon', '{"attachments":false,"buttons":false,"readReceipts":false,"maxTextLength":10000}', false);

INSERT INTO "sla_policies" ("id", "tier", "category", "param_code") VALUES
  ('t1-response', 'T1', NULL, 'PRM-02'),
  ('t2-response', 'T2', NULL, 'PRM-03'),
  ('t3-resolution', 'T3', NULL, 'PRM-04'),
  ('t3-payment', 'T3', 'pembayaran', 'PRM-05');
