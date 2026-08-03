CREATE TABLE "pvp_attacks" (
	"id" serial PRIMARY KEY NOT NULL,
	"attacker_user_id" uuid NOT NULL,
	"defender_user_id" uuid NOT NULL,
	"attacker_score" integer NOT NULL,
	"defender_score" integer NOT NULL,
	"outcome" text NOT NULL,
	"seeds_looted" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "player_state" ADD COLUMN "defense_score" integer;--> statement-breakpoint
ALTER TABLE "player_state" ADD COLUMN "defense_questions" jsonb;--> statement-breakpoint
ALTER TABLE "player_state" ADD COLUMN "defense_set_at" timestamp;--> statement-breakpoint
ALTER TABLE "player_state" ADD COLUMN "shielded_until" timestamp;--> statement-breakpoint
ALTER TABLE "pvp_attacks" ADD CONSTRAINT "pvp_attacks_attacker_user_id_users_id_fk" FOREIGN KEY ("attacker_user_id") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pvp_attacks" ADD CONSTRAINT "pvp_attacks_defender_user_id_users_id_fk" FOREIGN KEY ("defender_user_id") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;