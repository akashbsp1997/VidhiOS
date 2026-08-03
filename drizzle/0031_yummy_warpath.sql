ALTER TABLE "mastery" ADD COLUMN "growth_stage" text DEFAULT 'seed' NOT NULL;--> statement-breakpoint
ALTER TABLE "mastery" ADD COLUMN "retention_ease_factor" real DEFAULT 2.5 NOT NULL;--> statement-breakpoint
ALTER TABLE "mastery" ADD COLUMN "last_retention_checkpoint" jsonb DEFAULT '{}'::jsonb NOT NULL;