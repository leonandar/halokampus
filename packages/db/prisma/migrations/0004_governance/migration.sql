-- Phase 3: QA score/notes, usability respondents, DSR handling, CP feedback, generated reports.

-- AlterTable
ALTER TABLE "data_subject_requests" ADD COLUMN     "handled_by" UUID,
ADD COLUMN     "resolution_note_enc" TEXT;

-- AlterTable

-- AlterTable
ALTER TABLE "qa_reviews" ADD COLUMN     "note_enc" TEXT,
ADD COLUMN     "score_percent" DECIMAL(5,2);

-- AlterTable
ALTER TABLE "survey_responses" ADD COLUMN     "respondent_role" TEXT NOT NULL DEFAULT 'customer',
ADD COLUMN     "respondent_user_id" UUID;

-- CreateTable
CREATE TABLE "cp_feedback" (
    "id" UUID NOT NULL,
    "cp_user_id" UUID NOT NULL,
    "staff_user_id" UUID NOT NULL,
    "ticket_id" UUID,
    "text_enc" TEXT NOT NULL,
    "read_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cp_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "generated_reports" (
    "id" UUID NOT NULL,
    "period_from" TIMESTAMPTZ NOT NULL,
    "period_to" TIMESTAMPTZ NOT NULL,
    "format" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "content" BYTEA NOT NULL,
    "includes_dummy" BOOLEAN NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "generated_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cp_feedback_cp_user_id_created_at_idx" ON "cp_feedback"("cp_user_id", "created_at");

-- CreateIndex
CREATE INDEX "generated_reports_created_at_idx" ON "generated_reports"("created_at");

