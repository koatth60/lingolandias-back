-- Adds every teacher's currently-assigned students as members of that
-- teacher's group-chat conversation, so the group shows everyone even if a
-- given student never personally posted a message there historically.
BEGIN;
INSERT INTO conversation_members ("conversationId", "userId", role, "joinedAt", "lastReadAt")
SELECT c.id, s.id, 'member', now(), now()
FROM conversations c
JOIN users s ON s."teacherId"::text = c.id
WHERE c.type = 'group'
ON CONFLICT ("conversationId", "userId") DO NOTHING;
COMMIT;
