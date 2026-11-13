# 07 · Messaging, Notices, Notifications, Email & Push

Source: PRD §5.8, §5.9, §5.10, §4.6 (sockets). Skill: `cms-realtime-jobs`.

## 1. Socket.IO

- One server, path `/socket.io`, same origin. Handshake: read `cms_session` cookie → same check as HTTP (02 §1). Reject `first_login`, step-up-pending and inactive users.
- On connect the server joins the socket to: `user:<id>` and `conv:<id>` for each conversation where the user is a member with `leftAt IS NULL`. Clients never choose rooms.
- Session revocation (`revokeAllSessions`) emits `session:revoked` to `user:<id>` and calls `disconnectSockets()` for sockets of that session. Each socket stores its `loginSessionId`; a 5-minute timer re-validates it as a safety net.
- Membership changes (join/leave chat) call `socketsJoin/socketsLeave` for `user:<id>` sockets.
- Payloads validated with Zod; server → client events carry full objects so clients don't refetch.

| Client → server | Payload | Server action |
|---|---|---|
| `msg:send` | `{ conversationId, clientId, text?, attachmentId? }` | Same rules as `POST /messages` (§2.2); ack `{ ok, message }` or `{ ok:false, code }` |
| `msg:typing` | `{ conversationId }` | Throttled 1/3 s → `msg:typing` to room except sender |
| `msg:read` | `{ conversationId, messageId }` | Update `lastReadMessageId` (only forward) → `msg:read` to room |
| `presence:ping` | – | keeps `lastSeenAt` |

| Server → client | When |
|---|---|
| `msg:new` | message persisted (persist first, then emit) |
| `msg:deleted` | sender deleted a message / Admin removed it |
| `msg:read`, `msg:typing` | above |
| `notif:new` | Notification row created; payload includes unread count |
| `conv:joined` / `conv:left` | membership change |
| `session:revoked` | logout everywhere |

On reconnect, clients call `GET /api/chat/conversations/:id/messages?after=<lastId>` to fill gaps.

## 2. Messaging

### 2.1 Conversations
| Type | Members (auto-managed) |
|---|---|
| `direct` | two users; created on first message; `directKey = sorted ids`. Allowed pairs (PRD §5.8): student↔student, teacher↔student, Admin↔anyone. |
| `group` (one per session-group) | all active students of the group + the mentors of its sections. Not the Admin, not course teachers (PRD §2.1). |
| `section` (one per section) | active students of the section + its mentor + teachers of its active offerings. |

Group and section conversations are created with the section/session. Teacher ↔ teacher direct chat is not in the PRD list, so it is not offered (ask the client if needed).

### 2.2 Routes
| Route | Rules |
|---|---|
| `GET /api/chat/conversations?cursor` | Member conversations with last message, unread count (`messages after lastReadMessageId` not sent by me), other user for direct. |
| `POST /api/chat/direct` `{ userId }` | Returns existing or creates (pair rule; target active; neither blocked the other → `403 BLOCKED`). |
| `GET /api/chat/conversations/:id/messages?before|after&limit` | Member only (left members see history up to `leftAt`). Messages from users the viewer blocked are hidden. |
| `POST /api/chat/conversations/:id/messages` | Member with `leftAt` null; not muted (`403 MUTED`); direct: not blocked; rate limit 30/min; text ≤ 4,000 or attachment (image 5 MB / PDF 20 MB uploaded first via `POST /api/files/chat`). **Banned word → `422 BLOCKED_WORD` "This message contains a blocked word."** (not held). Persist, update `lastMessageAt`, emit, push/notify offline members (`new_message`, one per conversation per 5 min). |
| `DELETE /api/chat/messages/:id` | Sender only → `deletedAt` ("Message deleted" shown). |
| `POST /api/chat/blocks` `{ userId }` / `DELETE /api/chat/blocks/:userId` | Blocked user cannot start or send direct messages to the blocker; in group/section chats the blocker no longer sees the blocked user's messages. |
| Report message | `POST /api/reports { targetType: message }` (06 §5). |

Seen status: direct chats show "Seen" when the message the other member last read was created at or after this message (compare `createdAt`, not ids). Group chats show "Seen by N".

### 2.3 Membership sync (`chatMembership.sync(userId)`)
Called after: student create/move/pass-out/deactivate/delete, offering teacher change or end, mentor change. Computes the set of group/section conversations the user should be in, sets `leftAt` on extra ones, inserts/reactivates missing ones, updates socket rooms. Passed-out students leave group/section chats (PRD §4.5). Inactive users keep membership rows but cannot connect.

### 2.4 Admin review of reported messages
`GET /api/admin/moderation/message/:messageId/context` → the reported message + 10 before + 10 after in that conversation. No other chat browsing for the Admin. Actions: delete message, warn, mute (06 §6).

## 3. Notices

### 3.1 Audience
- **Central (Admin):** `{ all: true }` or `{ roles?: ["student","teacher"], sessionIds?, groupIds? }` (AND between keys, OR within a list). `showOnLanding` optional.
- **Class-wise (teacher/mentor):** `{ offeringIds?: [...], sectionIds?: [...] }` — teacher only offerings they teach and sections they teach in; mentor also their section. Audience = enrolled/active students of those + the author.

### 3.2 Routes
| Route | Rules |
|---|---|
| `POST /api/notices` (multipart) | `{ scope, audience, title (≤ 200), bodyHtml (sanitised), priority, attachments ≤ 5 (PDF/image), publishAt?, expiresAt?, showOnLanding? }`. Attachments go to the `public` bucket only when `showOnLanding`, else private. |
| `PATCH/DELETE /api/notices/:id` | Author or Admin. Editing after publish doesn't re-notify. |
| `GET /api/notices?filter=central|class&unread&cursor` | Via `NoticeRecipient` for the user; hides expired (`expiresAt < now`) and not yet published. |
| `POST /api/notices/:id/read` | `NoticeRead` upsert. |
| `GET /api/notices/urgent-unread` | Dashboard banner: urgent, unread, not expired. |
| `GET /api/public/notices` | Landing page: `showOnLanding`, published, not expired, latest 10; public attachment URLs. |

### 3.3 Publishing (job `notice.publish`)
At `publishAt` (immediately if now): resolve audience → insert `NoticeRecipient` rows (batches of 1,000) → `Notification` (`notice_new`) + socket + push → if priority `important`/`urgent` queue emails (normal priority in the email queue). Sets `publishedAt`. Idempotent (skip if `publishedAt`).

## 4. Notifications

- `GET /api/notifications?cursor`, `GET /api/notifications/unread-count`, `POST /api/notifications/read { ids? | all: true }`.
- `notify(userIds, type, ref, text)` helper: inserts rows, emits `notif:new`, enqueues push for users with subscriptions and the pref on, enqueues email for types that email (respecting prefs).
- Preferences: `GET/PUT /api/me/notification-prefs` per type: email on/off, push on/off. **Urgent notice email cannot be turned off** (PRD §5.10).

### 4.1 Catalogue (PRD §5.10 + other specs)

| type | To | Email |
|---|---|---|
| `notice_new` | recipients (teachers: central only) | important/urgent |
| `online_class_scheduled`, `online_class_starting` (15 min), `online_class_changed`, `online_class_cancelled` | enrolled students, teacher | – |
| `recording_new`, `material_new` | enrolled students | – |
| `exam_published`, `exam_starting_soon`, `result_published`, `exam_key_fixed` | enrolled students | – |
| `pinned_post` | pin audience | – |
| `reaction`, `comment`, `reply`, `new_message` | author / member | – |
| `course_assignment_changed`, `mentor_assigned` | teacher | – |
| `marked_absent`, `attendance_below_threshold` | student | – |
| `routine_changed`, `class_cancelled`, `substitute_assigned` | affected students / teachers | – |
| `content_removed`, `warning`, `muted` | author | – |

## 5. Email (Gmail SMTP, free)

- Nodemailer transport from env. Queue = pg-boss `email.send` with priority: **high** (password reset, verification, email change) before **normal** (notices).
- Daily limit: before sending, `UPDATE email_quota SET sent = sent + 1 WHERE date = dhakaToday() AND sent < limit RETURNING` (insert row if missing). If no row returned → re-schedule the job for 00:05 Dhaka next day (`startAfter`). High-priority emails reserve the last 10% of the limit (normal emails stop at 90%).
- In-app notifications are never delayed by email.
- Retries: 3 with exponential backoff; permanent failures logged. If SMTP is unreachable, log the auth link (02 §5).
- Templates: plain HTML + text, college name/logo, no personal data beyond the recipient's name.

## 6. Web push (free)

- `web-push` library with VAPID keys (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` env).
- `POST /api/me/push-subscriptions` `{ endpoint, keys }`, `DELETE /api/me/push-subscriptions` `{ endpoint }`.
- Service worker shows title + short text + URL; payload never includes message or post content (only "New message from X").
- 404/410 from the push service → delete the subscription.

## 7. Tests

- Socket rejected without valid session; revoked session disconnects; user cannot receive events for a conversation they left.
- Pair rule for direct chat; block stops direct messages; muted user can't send.
- Banned word → 422, nothing stored.
- Membership sync on move / mentor change / teacher change / pass-out.
- Unread counts and seen status.
- Notice audience resolution (central filters, class-wise scope limited to the author's offerings).
- Email quota: 451st email deferred to the next day; reset emails still sent while normal ones wait.
- Urgent notice email ignores user email pref.
