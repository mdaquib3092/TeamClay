CREATE TABLE `attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`object_key` text NOT NULL,
	`media_type` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workspaces` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`state` text NOT NULL,
	`updated_at` text NOT NULL
);
