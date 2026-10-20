ALTER TABLE "pr_intent" ADD COLUMN "status" text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "analysis" jsonb;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "evidence" jsonb;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "head_sha" text;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "context_hash" text;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "issue_hash" text;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "prompt_version" integer;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "linked_issue_number" integer;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "linked_issue_title" text;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "derivation_id" uuid;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "provider" text;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "model" text;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "tokens_in" integer;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "tokens_out" integer;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "provider_cost_usd" double precision;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "derived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "last_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "total_tokens_in" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "total_tokens_out" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "total_provider_cost_usd" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "total_cost_complete" boolean DEFAULT true NOT NULL;