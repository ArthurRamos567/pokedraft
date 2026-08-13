CREATE TYPE "public"."transaction_status" AS ENUM('pending', 'accepted', 'rejected', 'cancelled', 'approved', 'vetoed', 'expired');--> statement-breakpoint
CREATE TYPE "public"."transaction_type" AS ENUM('trade');--> statement-breakpoint
CREATE TYPE "public"."vote_kind" AS ENUM('approve', 'veto');--> statement-breakpoint
CREATE TABLE "team_profiles" (
	"member_id" uuid PRIMARY KEY NOT NULL,
	"team_name" text,
	"logo_url" text,
	"color" text,
	"motto" text
);
--> statement-breakpoint
CREATE TABLE "transaction_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"transaction_id" uuid NOT NULL,
	"from_member_id" uuid NOT NULL,
	"to_member_id" uuid NOT NULL,
	"species_id" text NOT NULL,
	CONSTRAINT "transaction_items_species_unique" UNIQUE("transaction_id","species_id")
);
--> statement-breakpoint
CREATE TABLE "transaction_votes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"transaction_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"vote" "vote_kind" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transaction_votes_unique" UNIQUE("transaction_id","member_id")
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"league_id" uuid NOT NULL,
	"type" "transaction_type" DEFAULT 'trade' NOT NULL,
	"status" "transaction_status" DEFAULT 'pending' NOT NULL,
	"proposed_by" uuid NOT NULL,
	"counterparty" uuid NOT NULL,
	"note" text,
	"responded_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"resolved_by" text,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "team_profiles" ADD CONSTRAINT "team_profiles_member_id_league_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."league_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_items" ADD CONSTRAINT "transaction_items_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_items" ADD CONSTRAINT "transaction_items_from_member_id_league_members_id_fk" FOREIGN KEY ("from_member_id") REFERENCES "public"."league_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_items" ADD CONSTRAINT "transaction_items_to_member_id_league_members_id_fk" FOREIGN KEY ("to_member_id") REFERENCES "public"."league_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_votes" ADD CONSTRAINT "transaction_votes_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_votes" ADD CONSTRAINT "transaction_votes_member_id_league_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."league_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_proposed_by_league_members_id_fk" FOREIGN KEY ("proposed_by") REFERENCES "public"."league_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_counterparty_league_members_id_fk" FOREIGN KEY ("counterparty") REFERENCES "public"."league_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_resolved_by_user_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transaction_items_from_idx" ON "transaction_items" USING btree ("from_member_id");--> statement-breakpoint
CREATE INDEX "transaction_items_to_idx" ON "transaction_items" USING btree ("to_member_id");--> statement-breakpoint
CREATE INDEX "transactions_league_idx" ON "transactions" USING btree ("league_id","status","created_at");--> statement-breakpoint
CREATE INDEX "transactions_member_idx" ON "transactions" USING btree ("proposed_by","counterparty");