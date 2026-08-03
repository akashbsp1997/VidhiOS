CREATE TABLE "daily_bounties" (
	"user_id" uuid NOT NULL,
	"bounty_date" text NOT NULL,
	"subtopic_id" text NOT NULL,
	"teach_done_at" timestamp,
	"current_affairs_done_at" timestamp,
	"notes_done_at" timestamp,
	"prelims_done_at" timestamp,
	"bloomed_at" timestamp,
	CONSTRAINT "daily_bounties_user_id_bounty_date_subtopic_id_pk" PRIMARY KEY("user_id","bounty_date","subtopic_id")
);
--> statement-breakpoint
ALTER TABLE "daily_bounties" ADD CONSTRAINT "daily_bounties_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_bounties" ADD CONSTRAINT "daily_bounties_subtopic_id_subtopics_id_fk" FOREIGN KEY ("subtopic_id") REFERENCES "public"."subtopics"("id") ON DELETE no action ON UPDATE no action;