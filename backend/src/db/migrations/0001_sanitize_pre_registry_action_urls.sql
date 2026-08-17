-- Rows created before the central event registry may contain producer-supplied
-- links. Runtime origins are unavailable to SQL migrations, so remove all old
-- actions; newly processed events recreate only centrally rendered links.
UPDATE `notifications` SET `action_url` = NULL WHERE `action_url` IS NOT NULL;
