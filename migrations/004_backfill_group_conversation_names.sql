-- The Fase 1 migration created group conversations for legacy
-- "teacher + all students" auto-chats but never gave them a name column
-- value, so they showed up blank in the UI.
UPDATE conversations c
SET name = 'Group Chat - ' || u.name
FROM users u
WHERE c.type = 'group' AND c.name IS NULL AND c."createdBy" = u.id;

UPDATE conversations
SET name = 'Group Chat'
WHERE type = 'group' AND name IS NULL;
