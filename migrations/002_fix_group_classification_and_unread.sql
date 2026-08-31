BEGIN;

-- 1. Reclassify teacher/admin-owned "dm" rooms that are actually their old
-- group-chat room (id collision: same UUID was reused as a 1:1 room key at
-- some point in the account's history AND later as the group-chat room key
-- once promoted to teacher). These have real, current group activity, so
-- treat them as groups going forward.
UPDATE conversations c
SET type = 'group', name = 'Group Chat - ' || u.name, "createdBy" = u.id
FROM users u
WHERE c.type = 'dm' AND u.id::text = c.id AND u.role IN ('teacher', 'admin');

-- 2. Global membership backfill: guarantee every historical sender of a
-- message is a member of that conversation, regardless of which legacy table
-- (chats vs global-chats) their messages originally came from. lastReadAt is
-- set to now() here (not left NULL) so this backfill doesn't retroactively
-- flood these members with "unread" badges for years-old history.
INSERT INTO conversation_members ("conversationId", "userId", role, "joinedAt", "lastReadAt")
SELECT DISTINCT m."conversationId", m."senderId", 'member', now(), now()
FROM messages m
WHERE m."senderId" IS NOT NULL
ON CONFLICT ("conversationId", "userId") DO NOTHING;

INSERT INTO conversation_members ("conversationId", "userId", role, "joinedAt", "lastReadAt")
SELECT DISTINCT am."conversationId", am."senderId", 'member', now(), now()
FROM archived_messages am
WHERE am."senderId" IS NOT NULL
ON CONFLICT ("conversationId", "userId") DO NOTHING;

-- 3. Same reasoning for every membership row created by the original Fase 1
-- migration (and the auto-join-on-registration path) that never had a real
-- "read" action performed against the new system yet — treat pre-existing
-- history as already read as of now, instead of "unread since the dawn of
-- time".
UPDATE conversation_members SET "lastReadAt" = now() WHERE "lastReadAt" IS NULL;

COMMIT;
