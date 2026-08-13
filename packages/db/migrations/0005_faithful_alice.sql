CREATE TYPE "public"."bracket_side" AS ENUM('winners', 'losers', 'final');--> statement-breakpoint
CREATE TYPE "public"."bracket_status" AS ENUM('pending', 'active', 'complete');--> statement-breakpoint
CREATE TYPE "public"."bracket_type" AS ENUM('single_elim', 'double_elim');--> statement-breakpoint
CREATE TABLE "bracket_matches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"bracket_id" uuid NOT NULL,
	"matchup_id" uuid,
	"slot" text NOT NULL,
	"round" integer NOT NULL,
	"side" "bracket_side" NOT NULL,
	"home_source" jsonb NOT NULL,
	"away_source" jsonb NOT NULL,
	"home_member_id" uuid,
	"away_member_id" uuid,
	"winner_member_id" uuid,
	CONSTRAINT "bracket_matches_slot_unique" UNIQUE("bracket_id","slot")
);
--> statement-breakpoint
CREATE TABLE "brackets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"season_id" uuid NOT NULL,
	"type" "bracket_type" DEFAULT 'single_elim' NOT NULL,
	"size" integer NOT NULL,
	"third_place" boolean DEFAULT false NOT NULL,
	"bracket_reset" boolean DEFAULT false NOT NULL,
	"seeds" jsonb NOT NULL,
	"status" "bracket_status" DEFAULT 'pending' NOT NULL,
	"champion_member_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brackets_seasonId_unique" UNIQUE("season_id")
);
--> statement-breakpoint
ALTER TABLE "bracket_matches" ADD CONSTRAINT "bracket_matches_bracket_id_brackets_id_fk" FOREIGN KEY ("bracket_id") REFERENCES "public"."brackets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bracket_matches" ADD CONSTRAINT "bracket_matches_matchup_id_matchups_id_fk" FOREIGN KEY ("matchup_id") REFERENCES "public"."matchups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bracket_matches" ADD CONSTRAINT "bracket_matches_home_member_id_league_members_id_fk" FOREIGN KEY ("home_member_id") REFERENCES "public"."league_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bracket_matches" ADD CONSTRAINT "bracket_matches_away_member_id_league_members_id_fk" FOREIGN KEY ("away_member_id") REFERENCES "public"."league_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bracket_matches" ADD CONSTRAINT "bracket_matches_winner_member_id_league_members_id_fk" FOREIGN KEY ("winner_member_id") REFERENCES "public"."league_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brackets" ADD CONSTRAINT "brackets_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brackets" ADD CONSTRAINT "brackets_champion_member_id_league_members_id_fk" FOREIGN KEY ("champion_member_id") REFERENCES "public"."league_members"("id") ON DELETE set null ON UPDATE no action;