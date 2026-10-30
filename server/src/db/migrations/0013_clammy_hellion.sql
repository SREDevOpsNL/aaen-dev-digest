CREATE TABLE "skill_approvals" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"skill_id" uuid,
	"skill_name" text NOT NULL,
	"version" integer NOT NULL,
	"body_sha256" text NOT NULL,
	"decision" text NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "skill_approvals" ADD CONSTRAINT "skill_approvals_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_approvals" ADD CONSTRAINT "skill_approvals_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_approvals" ADD CONSTRAINT "skill_approvals_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "skill_approvals_skill_id_idx" ON "skill_approvals" USING btree ("skill_id","id");