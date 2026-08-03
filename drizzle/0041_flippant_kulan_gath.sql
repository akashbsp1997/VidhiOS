ALTER TABLE "lesson_modules" ADD COLUMN "article_ref" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "lesson_modules" ADD COLUMN "timeline_events" jsonb DEFAULT '[]'::jsonb NOT NULL;