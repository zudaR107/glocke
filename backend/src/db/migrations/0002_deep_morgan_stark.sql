CREATE TABLE `push_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`source` text NOT NULL,
	`user_id` text NOT NULL,
	`subscription_id` text NOT NULL,
	`destination_url` text NOT NULL,
	`state` text NOT NULL,
	`attempts` integer NOT NULL,
	`next_attempt_at` integer,
	`lease_id` text,
	`lease_until` integer,
	`delivered_at` integer,
	`last_status` integer,
	`last_error` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_deliveries_event_subscription_unique` ON `push_deliveries` (`event_id`,`source`,`subscription_id`);--> statement-breakpoint
CREATE INDEX `push_deliveries_subscription_idx` ON `push_deliveries` (`subscription_id`);--> statement-breakpoint
CREATE INDEX `push_deliveries_claim_idx` ON `push_deliveries` (`state`,`lease_until`,`next_attempt_at`);--> statement-breakpoint
CREATE TABLE `push_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`endpoint` text NOT NULL,
	`endpoint_hash` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`expiration_time` integer,
	`provider_host` text NOT NULL,
	`vapid_key_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`last_success_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_subscriptions_endpoint_unique` ON `push_subscriptions` (`endpoint`);--> statement-breakpoint
CREATE INDEX `push_subscriptions_user_idx` ON `push_subscriptions` (`user_id`);