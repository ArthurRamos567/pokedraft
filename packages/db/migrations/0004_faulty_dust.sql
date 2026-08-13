CREATE TYPE "public"."matchup_status" AS ENUM('scheduled', 'reported', 'confirmed', 'disputed', 'forfeited', 'void');--> statement-breakpoint
CREATE TYPE "public"."season_status" AS ENUM('scheduled', 'active', 'complete');--> statement-breakpoint
CREATE TYPE "public"."week_status" AS ENUM('upcoming', 'open', 'closed');--> statement-breakpoint
CREATE TABLE "match_reports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"matchup_id" uuid NOT NULL,
	"reported_by" uuid NOT NULL,
	"winner_member_id" uuid,
	"home_score" integer DEFAULT 0 NOT NULL,
	"away_score" integer DEFAULT 0 NOT NULL,
	"replay_url" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "match_stats" (
	"id" uuid PRIMARY KEY NOT NULL,
	"matchup_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"species_id" text NOT NULL,
	"brought" boolean DEFAULT true NOT NULL,
	"kills" integer DEFAULT 0 NOT NULL,
	"deaths" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "match_stats_unique" UNIQUE("matchup_id","member_id","species_id")
);
--> statement-breakpoint
CREATE TABLE "matchups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"week_id" uuid NOT NULL,
	"home_member_id" uuid NOT NULL,
	"away_member_id" uuid,
	"status" "matchup_status" DEFAULT 'scheduled' NOT NULL,
	"winner_member_id" uuid,
	"home_score" integer DEFAULT 0 NOT NULL,
	"away_score" integer DEFAULT 0 NOT NULL,
	"replay_url" text,
	"scheduled_at" timestamp with time zone,
	"reported_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "matchups_home_unique" UNIQUE("week_id","home_member_id")
);
--> statement-breakpoint
CREATE TABLE "replay_cache" (
	"replay_id" text PRIMARY KEY NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"raw_log" text,
	"parsed" jsonb
);
--> statement-breakpoint
CREATE TABLE "seasons" (
	"id" uuid PRIMARY KEY NOT NULL,
	"league_id" uuid NOT NULL,
	"number" integer DEFAULT 1 NOT NULL,
	"status" "season_status" DEFAULT 'scheduled' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seasons_number_unique" UNIQUE("league_id","number")
);
--> statement-breakpoint
CREATE TABLE "weeks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"season_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"opens_at" timestamp with time zone,
	"closes_at" timestamp with time zone,
	"status" "week_status" DEFAULT 'upcoming' NOT NULL,
	CONSTRAINT "weeks_number_unique" UNIQUE("season_id","number")
);
--> statement-breakpoint
ALTER TABLE "match_reports" ADD CONSTRAINT "match_reports_matchup_id_matchups_id_fk" FOREIGN KEY ("matchup_id") REFERENCES "public"."matchups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_reports" ADD CONSTRAINT "match_reports_reported_by_league_members_id_fk" FOREIGN KEY ("reported_by") REFERENCES "public"."league_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_reports" ADD CONSTRAINT "match_reports_winner_member_id_league_members_id_fk" FOREIGN KEY ("winner_member_id") REFERENCES "public"."league_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_stats" ADD CONSTRAINT "match_stats_matchup_id_matchups_id_fk" FOREIGN KEY ("matchup_id") REFERENCES "public"."matchups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_stats" ADD CONSTRAINT "match_stats_member_id_league_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."league_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matchups" ADD CONSTRAINT "matchups_week_id_weeks_id_fk" FOREIGN KEY ("week_id") REFERENCES "public"."weeks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matchups" ADD CONSTRAINT "matchups_home_member_id_league_members_id_fk" FOREIGN KEY ("home_member_id") REFERENCES "public"."league_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matchups" ADD CONSTRAINT "matchups_away_member_id_league_members_id_fk" FOREIGN KEY ("away_member_id") REFERENCES "public"."league_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matchups" ADD CONSTRAINT "matchups_winner_member_id_league_members_id_fk" FOREIGN KEY ("winner_member_id") REFERENCES "public"."league_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weeks" ADD CONSTRAINT "weeks_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "match_stats_member_idx" ON "match_stats" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "matchups_week_idx" ON "matchups" USING btree ("week_id");--> statement-breakpoint
CREATE INDEX "matchups_member_idx" ON "matchups" USING btree ("home_member_id","away_member_id");