CREATE TABLE "weekly_plan_adjustments" (
	"user_id" uuid NOT NULL,
	"week_index" integer NOT NULL,
	"focus_subtopic_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"extra_revision_subtopic_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"generated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "weekly_plan_adjustments_user_id_week_index_pk" PRIMARY KEY("user_id","week_index")
);
--> statement-breakpoint
ALTER TABLE "weekly_plan_adjustments" ADD CONSTRAINT "weekly_plan_adjustments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;