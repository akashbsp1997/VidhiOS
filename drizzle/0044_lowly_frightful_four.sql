CREATE TABLE "subject_book_plans" (
	"subject_id" text NOT NULL,
	"paper" integer NOT NULL,
	"section" text NOT NULL,
	"plan_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"generated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "subject_book_plans_subject_id_paper_section_pk" PRIMARY KEY("subject_id","paper","section")
);
--> statement-breakpoint
ALTER TABLE "subject_book_plans" ADD CONSTRAINT "subject_book_plans_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;