CREATE TABLE "alliance_members" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"alliance_id" integer NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"joined_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alliances" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"tag" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "alliances_name_unique" UNIQUE("name"),
	CONSTRAINT "alliances_tag_unique" UNIQUE("tag")
);
--> statement-breakpoint
ALTER TABLE "alliance_members" ADD CONSTRAINT "alliance_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alliance_members" ADD CONSTRAINT "alliance_members_alliance_id_alliances_id_fk" FOREIGN KEY ("alliance_id") REFERENCES "public"."alliances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alliances" ADD CONSTRAINT "alliances_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;