CREATE TABLE "legal_case_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"case_id" integer NOT NULL,
	"event_type" text NOT NULL,
	"title" text NOT NULL,
	"event_date" timestamp NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'upcoming' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legal_cases" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"case_number" text,
	"case_type" text DEFAULT 'other' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"forum_id" integer,
	"court_name" text,
	"jurisdiction_state" text,
	"cause_of_action" text,
	"subject_matter" text,
	"claim_amount" real,
	"filing_date" timestamp,
	"description" text DEFAULT '' NOT NULL,
	"source_document_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legal_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"case_id" integer,
	"doc_type" text DEFAULT 'other' NOT NULL,
	"storage_path" text NOT NULL,
	"original_filename" text NOT NULL,
	"file_mime_type" text NOT NULL,
	"file_size_bytes" integer NOT NULL,
	"content_hash" text NOT NULL,
	"status" text DEFAULT 'uploaded' NOT NULL,
	"extracted_text" "bytea",
	"extracted_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error_msg" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"extracted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "legal_draft_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"draft_id" integer NOT NULL,
	"version_number" integer NOT NULL,
	"content" text NOT NULL,
	"edit_summary" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legal_drafts" (
	"id" serial PRIMARY KEY NOT NULL,
	"case_id" integer NOT NULL,
	"draft_type" text NOT NULL,
	"title" text NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"current_version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"generated_by_ai" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legal_forums" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"forum_type" text NOT NULL,
	"level" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"pecuniary_min" real,
	"pecuniary_max" real,
	"subject_tags" text[] DEFAULT '{}' NOT NULL,
	"case_type_tags" text[] DEFAULT '{}' NOT NULL,
	"appeals_to" text,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "legal_forums_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "legal_parties" (
	"id" serial PRIMARY KEY NOT NULL,
	"case_id" integer NOT NULL,
	"role" text NOT NULL,
	"name" text NOT NULL,
	"party_type" text DEFAULT 'individual' NOT NULL,
	"contact_info" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"advocate_name" text,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "legal_case_events" ADD CONSTRAINT "legal_case_events_case_id_legal_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."legal_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_cases" ADD CONSTRAINT "legal_cases_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_cases" ADD CONSTRAINT "legal_cases_forum_id_legal_forums_id_fk" FOREIGN KEY ("forum_id") REFERENCES "public"."legal_forums"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_documents" ADD CONSTRAINT "legal_documents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_documents" ADD CONSTRAINT "legal_documents_case_id_legal_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."legal_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_draft_versions" ADD CONSTRAINT "legal_draft_versions_draft_id_legal_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."legal_drafts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_drafts" ADD CONSTRAINT "legal_drafts_case_id_legal_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."legal_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_parties" ADD CONSTRAINT "legal_parties_case_id_legal_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."legal_cases"("id") ON DELETE no action ON UPDATE no action;