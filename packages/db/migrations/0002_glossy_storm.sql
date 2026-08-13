CREATE TYPE "public"."draft_status" AS ENUM('pending', 'active', 'paused', 'complete');--> statement-breakpoint
CREATE TABLE "draft_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"draft_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"actor_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "draft_events_seq_unique" UNIQUE("draft_id","seq")
);
--> statement-breakpoint
CREATE TABLE "draft_picks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"draft_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"species_id" text NOT NULL,
	"cost" integer NOT NULL,
	"round" integer NOT NULL,
	"pick_no" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "draft_picks_species_unique" UNIQUE("draft_id","species_id"),
	CONSTRAINT "draft_picks_pickno_unique" UNIQUE("draft_id","pick_no")
);
--> statement-breakpoint
CREATE TABLE "draft_queues" (
	"id" uuid PRIMARY KEY NOT NULL,
	"member_id" uuid NOT NULL,
	"species_id" text NOT NULL,
	"rank" integer NOT NULL,
	CONSTRAINT "draft_queues_species_unique" UNIQUE("member_id","species_id")
);
--> statement-breakpoint
CREATE TABLE "drafts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"league_id" uuid NOT NULL,
	"point_list_id" uuid,
	"status" "draft_status" DEFAULT 'pending' NOT NULL,
	"state" jsonb NOT NULL,
	"seq" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "drafts_leagueId_unique" UNIQUE("league_id")
);
--> statement-breakpoint
ALTER TABLE "draft_events" ADD CONSTRAINT "draft_events_draft_id_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_events" ADD CONSTRAINT "draft_events_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_picks" ADD CONSTRAINT "draft_picks_draft_id_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_picks" ADD CONSTRAINT "draft_picks_member_id_league_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."league_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_queues" ADD CONSTRAINT "draft_queues_member_id_league_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."league_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_point_list_id_point_lists_id_fk" FOREIGN KEY ("point_list_id") REFERENCES "public"."point_lists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "draft_events_draft_idx" ON "draft_events" USING btree ("draft_id","seq");--> statement-breakpoint
CREATE INDEX "draft_picks_member_idx" ON "draft_picks" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "draft_queues_member_idx" ON "draft_queues" USING btree ("member_id","rank");