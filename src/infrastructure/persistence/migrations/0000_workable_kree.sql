CREATE TABLE `copies` (
	`id` text PRIMARY KEY NOT NULL,
	`title_id` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `holds` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title_id` text NOT NULL,
	`member_id` text NOT NULL,
	`placed_at` text NOT NULL,
	`set_aside_copy_id` text,
	`pickup_by` text,
	`expired_at` text
);
--> statement-breakpoint
CREATE TABLE `loans` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`copy_id` text NOT NULL,
	`member_id` text NOT NULL,
	`started_at` text NOT NULL,
	`due_at` text NOT NULL,
	`returned_at` text,
	`lost_at` text,
	`renewals` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `loans_one_open_per_copy` ON `loans` (`copy_id`) WHERE "loans"."returned_at" is null;--> statement-breakpoint
CREATE TABLE `members` (
	`id` text PRIMARY KEY NOT NULL,
	`membership_expires_at` text NOT NULL,
	`outstanding_debt` integer DEFAULT 0 NOT NULL
);
