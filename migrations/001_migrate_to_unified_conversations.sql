BEGIN;

-- 1. Legacy fixed rooms (general/teacher/support) — id preserved exactly as
-- used today (also the Jitsi room name for teacher meetings).
INSERT INTO conversations (id, type, name, language, "createdBy", "linkedToSchedule", "createdAt")
VALUES
  ('uuid-english', 'general', 'General Chat - English', 'english', NULL, false, now()),
  ('uuid-spanish', 'general', 'General Chat - Spanish', 'spanish', NULL, false, now()),
  ('uuid-polish', 'general', 'General Chat - Polish', 'polish', NULL, false, now()),
  ('uuid-teacher-english', 'teacher', 'Teachers Chat - English', 'english', NULL, false, now()),
  ('uuid-teacher-spanish', 'teacher', 'Teachers Chat - Spanish', 'spanish', NULL, false, now()),
  ('uuid-teacher-polish', 'teacher', 'Teachers Chat - Polish', 'polish', NULL, false, now()),
  ('uuid-support', 'support', 'Support', NULL, NULL, false, now())
ON CONFLICT (id) DO NOTHING;

-- 2. DM conversations: every distinct room ever seen in chats/archived_chats
-- (room = the student's own user id, also their Jitsi room name).
INSERT INTO conversations (id, type, "createdBy", "linkedToSchedule", "createdAt")
SELECT DISTINCT room, 'dm', NULL::uuid, false, now()
FROM (
  SELECT room FROM chats
  UNION
  SELECT room FROM archived_chats
) r
ON CONFLICT (id) DO NOTHING;

-- 3. Group conversations: global-chats rooms that are real UUIDs (not one of
-- the 7 legacy strings) — today's "teacher + their students" auto-group.
INSERT INTO conversations (id, type, "createdBy", "linkedToSchedule", "createdAt")
SELECT DISTINCT room, 'group',
  (SELECT id FROM users WHERE id::text = "global-chats".room LIMIT 1),
  false, now()
FROM "global-chats"
WHERE room ~ '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$'
ON CONFLICT (id) DO NOTHING;

-- 4. Membership: general rooms -> users matching language
INSERT INTO conversation_members ("conversationId", "userId", role, "joinedAt")
SELECT 'uuid-' || lower(u.language), u.id, 'member', now()
FROM users u
WHERE lower(u.language) IN ('english', 'spanish', 'polish')
ON CONFLICT ("conversationId", "userId") DO NOTHING;

-- 4b. Membership: general rooms -> all admins
INSERT INTO conversation_members ("conversationId", "userId", role, "joinedAt")
SELECT c.id, u.id, 'member', now()
FROM conversations c CROSS JOIN users u
WHERE c.type = 'general' AND u.role = 'admin'
ON CONFLICT ("conversationId", "userId") DO NOTHING;

-- 5. Membership: teacher rooms -> teachers matching language
INSERT INTO conversation_members ("conversationId", "userId", role, "joinedAt")
SELECT 'uuid-teacher-' || lower(u.language), u.id, 'member', now()
FROM users u
WHERE u.role = 'teacher' AND lower(u.language) IN ('english', 'spanish', 'polish')
ON CONFLICT ("conversationId", "userId") DO NOTHING;

-- 5b. Membership: teacher rooms -> all admins
INSERT INTO conversation_members ("conversationId", "userId", role, "joinedAt")
SELECT c.id, u.id, 'member', now()
FROM conversations c CROSS JOIN users u
WHERE c.type = 'teacher' AND u.role = 'admin'
ON CONFLICT ("conversationId", "userId") DO NOTHING;

-- 6. Membership: support room -> teachers + admins
INSERT INTO conversation_members ("conversationId", "userId", role, "joinedAt")
SELECT 'uuid-support', u.id, 'member', now()
FROM users u
WHERE u.role IN ('teacher', 'admin')
ON CONFLICT ("conversationId", "userId") DO NOTHING;

-- 7. Membership: DM rooms -> the student themself (room = their own id)
INSERT INTO conversation_members ("conversationId", "userId", role, "joinedAt")
SELECT c.id, u.id, 'member', now()
FROM conversations c JOIN users u ON u.id::text = c.id
WHERE c.type = 'dm'
ON CONFLICT ("conversationId", "userId") DO NOTHING;

-- 7b. Membership: DM rooms -> that student's CURRENT teacher
INSERT INTO conversation_members ("conversationId", "userId", role, "joinedAt")
SELECT c.id, u."teacherId", 'member', now()
FROM conversations c
JOIN users u ON u.id::text = c.id
WHERE c.type = 'dm' AND u."teacherId" IS NOT NULL
ON CONFLICT ("conversationId", "userId") DO NOTHING;

-- 7c. Membership: DM rooms -> anyone who historically posted there by email
-- (covers teacher reassignment cases so old history stays reachable)
INSERT INTO conversation_members ("conversationId", "userId", role, "joinedAt")
SELECT DISTINCT m.room, u.id, 'member', now()
FROM (SELECT room, email FROM chats UNION SELECT room, email FROM archived_chats) m
JOIN users u ON lower(u.email) = lower(m.email)
JOIN conversations c ON c.id = m.room AND c.type = 'dm'
ON CONFLICT ("conversationId", "userId") DO NOTHING;

-- 8. Membership: group rooms -> the teacher who owns the room (if still exists)
INSERT INTO conversation_members ("conversationId", "userId", role, "joinedAt")
SELECT c.id, u.id, 'owner', now()
FROM conversations c JOIN users u ON u.id::text = c.id
WHERE c.type = 'group'
ON CONFLICT ("conversationId", "userId") DO NOTHING;

-- 8b. Membership: group rooms -> that teacher's current students
INSERT INTO conversation_members ("conversationId", "userId", role, "joinedAt")
SELECT c.id, s.id, 'member', now()
FROM conversations c
JOIN users s ON s."teacherId"::text = c.id
WHERE c.type = 'group'
ON CONFLICT ("conversationId", "userId") DO NOTHING;

-- 8c. Membership: group rooms -> anyone who historically posted there by email
-- (covers orphaned groups whose teacher account was later deleted)
INSERT INTO conversation_members ("conversationId", "userId", role, "joinedAt")
SELECT DISTINCT gc.room, u.id, 'member', now()
FROM "global-chats" gc
JOIN users u ON lower(u.email) = lower(gc.email)
JOIN conversations c ON c.id = gc.room AND c.type = 'group'
ON CONFLICT ("conversationId", "userId") DO NOTHING;

-- 9. Messages: copy chats (1:1) -> unified messages table
INSERT INTO messages (id, "conversationId", "senderId", username, email, "avatarUrl", message, "fileUrl", "userUrl", "userRole", "replyTo", "editedAt", timestamp)
SELECT c.id, c.room, u.id, c.username, c.email, c."avatarUrl", c.message, NULL::varchar, c."userUrl", NULL::varchar, c."replyTo", NULL::timestamp, c.timestamp
FROM chats c
LEFT JOIN users u ON lower(u.email) = lower(c.email)
ON CONFLICT (id) DO NOTHING;

-- 10. Messages: copy global-chats (general/teacher/support/group) -> unified messages table
INSERT INTO messages (id, "conversationId", "senderId", username, email, "avatarUrl", message, "fileUrl", "userUrl", "userRole", "replyTo", "editedAt", timestamp)
SELECT gc.id, gc.room, u.id, gc.username, gc.email, gc."avatarUrl", gc.message, gc."fileUrl", gc."userUrl", gc."userRole", NULL::jsonb, NULL::timestamp, gc.timestamp
FROM "global-chats" gc
LEFT JOIN users u ON lower(u.email) = lower(gc.email)
ON CONFLICT (id) DO NOTHING;

-- 11. Archived messages: copy archived_chats -> archived_messages
INSERT INTO archived_messages (id, "conversationId", "senderId", username, email, "avatarUrl", message, "fileUrl", "userUrl", "replyTo", timestamp, "archivedAt")
SELECT ac.id, ac.room, u.id, ac.username, ac.email, NULL::varchar, ac.message, NULL::varchar, NULL::varchar, NULL::jsonb, ac.timestamp, ac."archivedAt"
FROM archived_chats ac
LEFT JOIN users u ON lower(u.email) = lower(ac.email)
ON CONFLICT (id) DO NOTHING;

COMMIT;
