CREATE TYPE "public"."auth_provider" AS ENUM('keycloak', 'local');--> statement-breakpoint
CREATE TYPE "public"."jira_credential_kind" AS ENUM('pat', 'oauth');--> statement-breakpoint
CREATE TYPE "public"."outbox_state" AS ENUM('pending', 'in_flight', 'done', 'error', 'dead');--> statement-breakpoint
CREATE TYPE "public"."sync_state" AS ENUM('synced', 'pending', 'pushing', 'error', 'conflict');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('user', 'team_admin', 'app_admin');--> statement-breakpoint
CREATE TYPE "public"."workflow_plan_state" AS ENUM('draft', 'queued', 'running', 'paused', 'done', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."workflow_step_state" AS ENUM('pending', 'running', 'done', 'failed', 'skipped');--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"jira_id" text NOT NULL,
	"issue_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text,
	"size" bigint,
	"author_id" text,
	"content_url" text NOT NULL,
	"local_path" text,
	"created_at" timestamp with time zone NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"action" text NOT NULL,
	"target_kind" text NOT NULL,
	"target_id" text NOT NULL,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "boards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"jira_id" integer NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"project_id" uuid,
	"filter_jql" text,
	"config" jsonb DEFAULT '{"columns":[]}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"jira_id" text,
	"issue_id" uuid NOT NULL,
	"author_id" text NOT NULL,
	"body" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sync_state" "sync_state" DEFAULT 'synced' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conflicts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"target_kind" text NOT NULL,
	"target_id" uuid NOT NULL,
	"diff" jsonb NOT NULL,
	"outbox_payload" jsonb,
	"remote_snapshot" jsonb,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	"resolution" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_sub" text NOT NULL,
	"provider" "auth_provider" NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"roles" "user_role"[] DEFAULT '{user}'::user_role[] NOT NULL,
	"jira_account_id" text,
	"jira_user_key" text,
	"avatar_url" text,
	"disabled_at" timestamp with time zone,
	"capacity_hours_per_week" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"refresh_token_enc" "bytea",
	"refresh_token_iv" "bytea",
	"ip" text,
	"user_agent" text,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "local_credentials" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"must_change" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "jira_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "jira_credential_kind" NOT NULL,
	"ciphertext" "bytea" NOT NULL,
	"iv" "bytea" NOT NULL,
	"tag" "bytea" NOT NULL,
	"kek_kid" text NOT NULL,
	"jira_display_name" text,
	"needs_reattach" text,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"jira_id" text NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"project_type_key" text,
	"lead_account_id" text,
	"metadata" jsonb DEFAULT '{"customfieldMap":{},"promoted":{}}'::jsonb NOT NULL,
	"etag" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "field_schemas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"issue_type_id" uuid NOT NULL,
	"fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"upstream_hash" text,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issue_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"jira_id" text NOT NULL,
	"name" text NOT NULL,
	"icon_url" text,
	"subtask" boolean DEFAULT false NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "link_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"jira_id" text NOT NULL,
	"name" text NOT NULL,
	"inward" text NOT NULL,
	"outward" text NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "priorities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"jira_id" text NOT NULL,
	"name" text NOT NULL,
	"icon_url" text,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resolutions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"jira_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "statuses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"jira_id" text NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"color_name" text,
	"description" text,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"jira_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"key" text NOT NULL,
	"summary" text NOT NULL,
	"description_text" text,
	"description" jsonb,
	"issue_type_id" uuid NOT NULL,
	"status_id" uuid NOT NULL,
	"priority_id" uuid,
	"resolution_id" uuid,
	"reporter_id" text,
	"assignee_id" text,
	"parent_jira_id" text,
	"epic_jira_id" text,
	"sprint_id" uuid,
	"labels" text[] DEFAULT '{}'::text[] NOT NULL,
	"components" text[] DEFAULT '{}'::text[] NOT NULL,
	"fix_versions" text[] DEFAULT '{}'::text[] NOT NULL,
	"due_date" date,
	"start_date" date,
	"story_points" numeric(6, 2),
	"time_estimate_s" integer,
	"time_spent_s" integer,
	"custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ordering_rank" text,
	"position_idx" bigint,
	"etag" text,
	"jira_updated_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sync_state" "sync_state" DEFAULT 'synced' NOT NULL,
	"sync_error" text,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "issue_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"jira_id" text,
	"link_type_id" uuid NOT NULL,
	"source_issue_id" uuid NOT NULL,
	"target_issue_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worklogs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"jira_id" text,
	"issue_id" uuid NOT NULL,
	"author_id" text NOT NULL,
	"seconds" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"comment" text,
	"updated_at" timestamp with time zone NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sync_state" "sync_state" DEFAULT 'synced' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sprints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"jira_id" integer NOT NULL,
	"name" text NOT NULL,
	"state" text NOT NULL,
	"start_date" timestamp with time zone,
	"end_date" timestamp with time zone,
	"complete_date" timestamp with time zone,
	"board_id" uuid,
	"goal" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"idempotency_key" text NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"target_kind" text NOT NULL,
	"target_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"traceparent" text,
	"requires" text[] DEFAULT '{}'::text[] NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"state" "outbox_state" DEFAULT 'pending' NOT NULL,
	"last_error" text,
	"locked_by" text,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_cursor" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"last_updated_at" timestamp with time zone,
	"last_full_sync_at" timestamp with time zone,
	"last_run_id" text,
	"window_jql" text
);
--> statement-breakpoint
CREATE TABLE "webhook_inbox" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issue_type_id" uuid NOT NULL,
	"from_status_id" uuid NOT NULL,
	"to_status_id" uuid NOT NULL,
	"jira_transition_id" text NOT NULL,
	"name" text NOT NULL,
	"required_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issue_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"from_status_id" uuid NOT NULL,
	"to_status_id" uuid NOT NULL,
	"state" "workflow_plan_state" DEFAULT 'draft' NOT NULL,
	"context" jsonb NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "workflow_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"from_status_id" uuid NOT NULL,
	"to_status_id" uuid NOT NULL,
	"jira_transition_id" text NOT NULL,
	"field_values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"state" "workflow_step_state" DEFAULT 'pending' NOT NULL,
	"outbox_key" text,
	"error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "saved_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"shared" boolean DEFAULT false NOT NULL,
	"search" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boards" ADD CONSTRAINT "boards_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conflicts" ADD CONSTRAINT "conflicts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conflicts" ADD CONSTRAINT "conflicts_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "local_credentials" ADD CONSTRAINT "local_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jira_credentials" ADD CONSTRAINT "jira_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_schemas" ADD CONSTRAINT "field_schemas_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_schemas" ADD CONSTRAINT "field_schemas_issue_type_id_issue_types_id_fk" FOREIGN KEY ("issue_type_id") REFERENCES "public"."issue_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_issue_type_id_issue_types_id_fk" FOREIGN KEY ("issue_type_id") REFERENCES "public"."issue_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_status_id_statuses_id_fk" FOREIGN KEY ("status_id") REFERENCES "public"."statuses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_priority_id_priorities_id_fk" FOREIGN KEY ("priority_id") REFERENCES "public"."priorities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_resolution_id_resolutions_id_fk" FOREIGN KEY ("resolution_id") REFERENCES "public"."resolutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_sprint_id_sprints_id_fk" FOREIGN KEY ("sprint_id") REFERENCES "public"."sprints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_links" ADD CONSTRAINT "issue_links_link_type_id_link_types_id_fk" FOREIGN KEY ("link_type_id") REFERENCES "public"."link_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_links" ADD CONSTRAINT "issue_links_source_issue_id_issues_id_fk" FOREIGN KEY ("source_issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_links" ADD CONSTRAINT "issue_links_target_issue_id_issues_id_fk" FOREIGN KEY ("target_issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklogs" ADD CONSTRAINT "worklogs_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprints" ADD CONSTRAINT "sprints_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_cursor" ADD CONSTRAINT "sync_cursor_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transitions" ADD CONSTRAINT "transitions_issue_type_id_issue_types_id_fk" FOREIGN KEY ("issue_type_id") REFERENCES "public"."issue_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transitions" ADD CONSTRAINT "transitions_from_status_id_statuses_id_fk" FOREIGN KEY ("from_status_id") REFERENCES "public"."statuses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transitions" ADD CONSTRAINT "transitions_to_status_id_statuses_id_fk" FOREIGN KEY ("to_status_id") REFERENCES "public"."statuses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_plans" ADD CONSTRAINT "workflow_plans_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_plans" ADD CONSTRAINT "workflow_plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_steps" ADD CONSTRAINT "workflow_steps_plan_id_workflow_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."workflow_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attachments_jira_id_uq" ON "attachments" USING btree ("jira_id");--> statement-breakpoint
CREATE INDEX "attachments_issue_idx" ON "attachments" USING btree ("issue_id");--> statement-breakpoint
CREATE INDEX "audit_log_action_idx" ON "audit_log" USING btree ("action");--> statement-breakpoint
CREATE INDEX "audit_log_target_idx" ON "audit_log" USING btree ("target_kind","target_id");--> statement-breakpoint
CREATE INDEX "audit_log_created_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "boards_jira_id_uq" ON "boards" USING btree ("jira_id");--> statement-breakpoint
CREATE INDEX "boards_project_idx" ON "boards" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "comments_jira_id_uq" ON "comments" USING btree ("jira_id");--> statement-breakpoint
CREATE INDEX "comments_issue_idx" ON "comments" USING btree ("issue_id");--> statement-breakpoint
CREATE INDEX "conflicts_target_idx" ON "conflicts" USING btree ("target_kind","target_id");--> statement-breakpoint
CREATE INDEX "conflicts_unresolved_idx" ON "conflicts" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "users_provider_sub_uq" ON "users" USING btree ("provider","external_sub");--> statement-breakpoint
CREATE INDEX "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "users_jira_account_idx" ON "users" USING btree ("jira_account_id");--> statement-breakpoint
CREATE INDEX "user_sessions_user_idx" ON "user_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_sessions_expires_idx" ON "user_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "local_credentials_username_uq" ON "local_credentials" USING btree ("username");--> statement-breakpoint
CREATE UNIQUE INDEX "jira_credentials_user_kind_uq" ON "jira_credentials" USING btree ("user_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_jira_id_uq" ON "projects" USING btree ("jira_id");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_key_uq" ON "projects" USING btree ("key");--> statement-breakpoint
CREATE INDEX "projects_name_idx" ON "projects" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "field_schemas_project_issuetype_uq" ON "field_schemas" USING btree ("project_id","issue_type_id");--> statement-breakpoint
CREATE UNIQUE INDEX "issue_types_jira_id_uq" ON "issue_types" USING btree ("jira_id");--> statement-breakpoint
CREATE INDEX "issue_types_name_idx" ON "issue_types" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "link_types_jira_id_uq" ON "link_types" USING btree ("jira_id");--> statement-breakpoint
CREATE UNIQUE INDEX "priorities_jira_id_uq" ON "priorities" USING btree ("jira_id");--> statement-breakpoint
CREATE UNIQUE INDEX "resolutions_jira_id_uq" ON "resolutions" USING btree ("jira_id");--> statement-breakpoint
CREATE UNIQUE INDEX "statuses_jira_id_uq" ON "statuses" USING btree ("jira_id");--> statement-breakpoint
CREATE INDEX "statuses_name_idx" ON "statuses" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "issues_jira_id_uq" ON "issues" USING btree ("jira_id");--> statement-breakpoint
CREATE UNIQUE INDEX "issues_key_uq" ON "issues" USING btree ("key");--> statement-breakpoint
CREATE INDEX "issues_project_status_idx" ON "issues" USING btree ("project_id","status_id");--> statement-breakpoint
CREATE INDEX "issues_assignee_idx" ON "issues" USING btree ("assignee_id");--> statement-breakpoint
CREATE INDEX "issues_epic_idx" ON "issues" USING btree ("epic_jira_id");--> statement-breakpoint
CREATE INDEX "issues_parent_idx" ON "issues" USING btree ("parent_jira_id");--> statement-breakpoint
CREATE INDEX "issues_sprint_idx" ON "issues" USING btree ("sprint_id");--> statement-breakpoint
CREATE INDEX "issues_updated_at_idx" ON "issues" USING btree ("jira_updated_at");--> statement-breakpoint
CREATE INDEX "issues_sync_state_idx" ON "issues" USING btree ("sync_state");--> statement-breakpoint
CREATE INDEX "issues_labels_gin" ON "issues" USING gin ("labels");--> statement-breakpoint
CREATE INDEX "issues_components_gin" ON "issues" USING gin ("components");--> statement-breakpoint
CREATE INDEX "issues_custom_fields_gin" ON "issues" USING gin ("custom_fields" jsonb_path_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "issue_links_uq" ON "issue_links" USING btree ("link_type_id","source_issue_id","target_issue_id","direction");--> statement-breakpoint
CREATE INDEX "issue_links_source_idx" ON "issue_links" USING btree ("source_issue_id");--> statement-breakpoint
CREATE INDEX "issue_links_target_idx" ON "issue_links" USING btree ("target_issue_id");--> statement-breakpoint
CREATE UNIQUE INDEX "worklogs_jira_id_uq" ON "worklogs" USING btree ("jira_id");--> statement-breakpoint
CREATE INDEX "worklogs_issue_idx" ON "worklogs" USING btree ("issue_id");--> statement-breakpoint
CREATE INDEX "worklogs_author_started_idx" ON "worklogs" USING btree ("author_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sprints_jira_id_uq" ON "sprints" USING btree ("jira_id");--> statement-breakpoint
CREATE INDEX "sprints_board_idx" ON "sprints" USING btree ("board_id");--> statement-breakpoint
CREATE INDEX "sprints_state_idx" ON "sprints" USING btree ("state");--> statement-breakpoint
CREATE UNIQUE INDEX "outbox_idempotency_uq" ON "outbox_events" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "outbox_pending_idx" ON "outbox_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "outbox_target_idx" ON "outbox_events" USING btree ("target_kind","target_id");--> statement-breakpoint
CREATE INDEX "outbox_state_idx" ON "outbox_events" USING btree ("state");--> statement-breakpoint
CREATE INDEX "webhook_inbox_unprocessed_idx" ON "webhook_inbox" USING btree ("received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "transitions_uq" ON "transitions" USING btree ("issue_type_id","from_status_id","to_status_id");--> statement-breakpoint
CREATE INDEX "transitions_from_idx" ON "transitions" USING btree ("issue_type_id","from_status_id");--> statement-breakpoint
CREATE INDEX "workflow_plans_issue_idx" ON "workflow_plans" USING btree ("issue_id");--> statement-breakpoint
CREATE INDEX "workflow_plans_state_idx" ON "workflow_plans" USING btree ("state");--> statement-breakpoint
CREATE INDEX "workflow_plans_user_idx" ON "workflow_plans" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_steps_plan_seq_uq" ON "workflow_steps" USING btree ("plan_id","seq");--> statement-breakpoint
CREATE INDEX "workflow_steps_state_idx" ON "workflow_steps" USING btree ("state");--> statement-breakpoint
CREATE INDEX "saved_views_board_owner_idx" ON "saved_views" USING btree ("board_id","owner_id");--> statement-breakpoint
CREATE INDEX "saved_views_shared_idx" ON "saved_views" USING btree ("board_id","shared");