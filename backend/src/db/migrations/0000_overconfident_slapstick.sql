CREATE TABLE `inbox_events` (
	`source` text NOT NULL,
	`event_id` text NOT NULL,
	`user_id` text NOT NULL,
	`payload_hash` text NOT NULL,
	`envelope` text NOT NULL,
	`status` text NOT NULL,
	`accepted_at` integer NOT NULL,
	`processed_at` integer,
	`lease_until` integer,
	`lease_id` text,
	PRIMARY KEY(`source`, `event_id`)
);
--> statement-breakpoint
CREATE INDEX `inbox_claim_idx` ON `inbox_events` (`status`,`lease_until`,`accepted_at`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`event_id` text NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`action_url` text,
	`created_at` integer NOT NULL,
	`read_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_event_recipient_unique` ON `notifications` (`source`,`event_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `notifications_user_created_idx` ON `notifications` (`user_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `notifications_user_unread_idx` ON `notifications` (`user_id`,`read_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL
);
