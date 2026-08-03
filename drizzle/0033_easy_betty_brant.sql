CREATE TABLE "personal_sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"subtopic_id" text NOT NULL,
	"title" text NOT NULL,
	"storage_path" text NOT NULL,
	"file_size_bytes" integer,
	"page_count" integer,
	"extracted_text" "bytea",
	"status" text DEFAULT 'pending' NOT NULL,
	"error_msg" text,
	"added_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "personal_sources" ADD CONSTRAINT "personal_sources_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_sources" ADD CONSTRAINT "personal_sources_subtopic_id_subtopics_id_fk" FOREIGN KEY ("subtopic_id") REFERENCES "public"."subtopics"("id") ON DELETE no action ON UPDATE no action;