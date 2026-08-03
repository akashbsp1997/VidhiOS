CREATE TABLE "dragon_challenges" (
	"user_id" uuid NOT NULL,
	"subtopic_id" text NOT NULL,
	"question_text" text NOT NULL,
	"marks" integer NOT NULL,
	"pyq_id" text,
	"answer_text" text,
	"submitted_at" timestamp,
	"score" integer,
	"feedback" jsonb,
	"graded_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "dragon_challenges_user_id_subtopic_id_pk" PRIMARY KEY("user_id","subtopic_id")
);
--> statement-breakpoint
ALTER TABLE "dragon_challenges" ADD CONSTRAINT "dragon_challenges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dragon_challenges" ADD CONSTRAINT "dragon_challenges_subtopic_id_subtopics_id_fk" FOREIGN KEY ("subtopic_id") REFERENCES "public"."subtopics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dragon_challenges" ADD CONSTRAINT "dragon_challenges_pyq_id_pyqs_id_fk" FOREIGN KEY ("pyq_id") REFERENCES "public"."pyqs"("id") ON DELETE no action ON UPDATE no action;