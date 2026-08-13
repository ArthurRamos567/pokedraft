CREATE TYPE "public"."autopick_policy" AS ENUM('skip', 'queue_then_skip', 'queue_then_best');--> statement-breakpoint
CREATE TYPE "public"."draft_mode" AS ENUM('live', 'async');--> statement-breakpoint
CREATE TYPE "public"."draft_type" AS ENUM('snake', 'linear');--> statement-breakpoint
CREATE TYPE "public"."league_status" AS ENUM('setup', 'drafting', 'regular_season', 'playoffs', 'complete', 'archived');--> statement-breakpoint
CREATE TYPE "public"."league_visibility" AS ENUM('public', 'private');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('host', 'cohost', 'player', 'spectator');--> statement-breakpoint
CREATE TYPE "public"."member_status" AS ENUM('active', 'removed');--> statement-breakpoint
CREATE TYPE "public"."point_list_source" AS ENUM('yml_upload', 'manual', 'cloned');--> statement-breakpoint
CREATE TABLE "league_invites" (
	"id" uuid PRIMARY KEY NOT NULL,
	"league_id" uuid NOT NULL,
	"code" text NOT NULL,
	"created_by" text NOT NULL,
	"max_uses" integer,
	"uses" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "league_invites_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "league_members" (
	"id" uuid PRIMARY KEY NOT NULL,
	"league_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" "member_role" DEFAULT 'player' NOT NULL,
	"team_name" text,
	"team_logo_url" text,
	"draft_position" integer,
	"status" "member_status" DEFAULT 'active' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "league_members_unique" UNIQUE("league_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "league_settings" (
	"league_id" uuid PRIMARY KEY NOT NULL,
	"draft_mode" "draft_mode" DEFAULT 'live' NOT NULL,
	"draft_type" "draft_type" DEFAULT 'snake' NOT NULL,
	"pick_seconds" integer DEFAULT 90 NOT NULL,
	"turn_hours" integer DEFAULT 24 NOT NULL,
	"budget" integer DEFAULT 100 NOT NULL,
	"roster_min" integer DEFAULT 6 NOT NULL,
	"roster_max" integer DEFAULT 10 NOT NULL,
	"allow_undrafted" boolean DEFAULT false NOT NULL,
	"max_members" integer DEFAULT 8 NOT NULL,
	"trades_enabled" boolean DEFAULT true NOT NULL,
	"trades_require_host_approval" boolean DEFAULT false NOT NULL,
	"trade_deadline_week" integer,
	"autopick_policy" "autopick_policy" DEFAULT 'queue_then_skip' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leagues" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"visibility" "league_visibility" DEFAULT 'private' NOT NULL,
	"status" "league_status" DEFAULT 'setup' NOT NULL,
	"format_id" text NOT NULL,
	"host_id" text NOT NULL,
	"banner_url" text,
	"logo_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leagues_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "point_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"point_list_id" uuid NOT NULL,
	"species_id" text NOT NULL,
	"points" integer NOT NULL,
	"banned" boolean DEFAULT false NOT NULL,
	"notes" text,
	CONSTRAINT "point_entries_species_unique" UNIQUE("point_list_id","species_id")
);
--> statement-breakpoint
CREATE TABLE "point_lists" (
	"id" uuid PRIMARY KEY NOT NULL,
	"league_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"name" text,
	"source" "point_list_source" DEFAULT 'yml_upload' NOT NULL,
	"raw_source" text,
	"created_by" text,
	"locked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "point_lists_version_unique" UNIQUE("league_id","version")
);
--> statement-breakpoint
ALTER TABLE "league_invites" ADD CONSTRAINT "league_invites_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_invites" ADD CONSTRAINT "league_invites_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_members" ADD CONSTRAINT "league_members_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_members" ADD CONSTRAINT "league_members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_settings" ADD CONSTRAINT "league_settings_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leagues" ADD CONSTRAINT "leagues_host_id_user_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "point_entries" ADD CONSTRAINT "point_entries_point_list_id_point_lists_id_fk" FOREIGN KEY ("point_list_id") REFERENCES "public"."point_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "point_lists" ADD CONSTRAINT "point_lists_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "point_lists" ADD CONSTRAINT "point_lists_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "league_invites_league_idx" ON "league_invites" USING btree ("league_id");--> statement-breakpoint
CREATE INDEX "league_members_league_idx" ON "league_members" USING btree ("league_id","status");--> statement-breakpoint
CREATE INDEX "league_members_user_idx" ON "league_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "leagues_visibility_idx" ON "leagues" USING btree ("visibility","status","created_at");--> statement-breakpoint
CREATE INDEX "leagues_host_idx" ON "leagues" USING btree ("host_id");--> statement-breakpoint
CREATE INDEX "point_entries_list_idx" ON "point_entries" USING btree ("point_list_id");--> statement-breakpoint
CREATE INDEX "point_lists_league_idx" ON "point_lists" USING btree ("league_id","version");