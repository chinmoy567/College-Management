# Plan 07 · Messaging, Notices, Notifications, Email & Push (Milestone M9)

Spec: `docs/spec/07-chat-notices-notifications.md` · PRD §5.8–5.10, §4.6. Agent: `realtime-builder`. Skill: `cms-realtime-jobs`.
Depends on M3 (membership sync), M8 (banned words, mute, reports, author line). Already in place from M2/M3: socket auth + `user:<id>` room, `email.send` + quota, `notify()` (rows + `notif:new`), `chatMembership.sync()`.

## 1. Build order

1. **Socket layer completion** (`realtime/`):
   - On connect join `conv:<id>` for every active membership (one query).
   - Event handlers with Zod payloads: `msg:send` (delegates to the same service as REST, ack `{ok,message}`), `msg:typing` (throttle 1/3 s per user+conv, in memory), `msg:read` (forward-only `lastReadMessageId`), `presence:ping`.
   - `chatMembership.sync` now also calls `socketsJoin/socketsLeave` and emits `conv:joined/left`.
   - 5-minute session revalidation timer per socket (from M2) confirmed.
2. **Messaging service** (§2): conversations list with last message + unread count (one SQL with lateral join), direct create/get with pair rules (`directKey` = sorted ids; allowed pairs student↔student, teacher↔student, teacher↔teacher, Admin↔anyone), blocks, messages history (`before/after` cursors; left members see up to `leftAt`; blocked users' messages hidden for the blocker), send (member, not left, not muted, not blocked, 30/min rate limit, text ≤ 4,000 or attachment, **banned word → 422 `BLOCKED_WORD`, nothing stored**), persist → `lastMessageAt` → emit `msg:new` → offline members get `new_message` notification max 1 per conversation per 5 min, delete own message (`msg:deleted`).
3. **Chat attachments**: `POST /api/files/chat` (image 5 MB / PDF 20 MB) → `StorageObject` owned by the uploader, bound to the message on send; read via signed URL after membership check.
4. **Seen status**: direct "Seen" by `createdAt` comparison against the other member's last read message; group "Seen by N" = members whose last-read message `createdAt >= message.createdAt`.
5. **Admin message review** (§2.4): context endpoint (reported message ± 10) only when an open report exists for that message; actions reuse 06 moderation. Complete the message branch of `POST /api/reports` (reporter must be a member).
6. **Notices** (§3): audience model (central: all / roles × sessions × groups; class-wise: author's offerings/sections, mentor's section), sanitised rich text (`sanitize-html` allow-list), attachments (public bucket only if `showOnLanding`), `notice.publish` job (resolve audience → `NoticeRecipient` in batches of 1,000 → notifications + socket + push → important/urgent emails; idempotent on `publishedAt`), list with filters + unread, read, urgent-unread banner, public landing list.
7. **Notifications** (§4): list, unread count, mark read; `notify()` now fans out to push and email per type and per `NotificationPref`; **urgent notice email cannot be turned off** (enforced in `notify`, and the pref UI disables the toggle).
8. **Email** (§5): finish priority reservation (normal stops at 90% of `email_daily_limit`), retries with exponential backoff, templates for notices.
9. **Web push** (§6): `web-push` with VAPID; subscribe/unsubscribe routes; `push.send` job; payload = title + short generic text + URL, **never** message/post content; 404/410 → delete subscription. Service worker push handler (shared with PWA work in M12).
10. **Screens**: `/messages` (conversation list with unread), `/messages/[id]` (virtualised `ChatThread`, optimistic send with `clientId`, typing indicator, seen ticks, reconnect gap-fill via `?after=`), block/report menu, `/notifications`, bell with live count, `/notices` with Central / My Classes filter + unread markers, notice composer (TipTap minimal, lazy), urgent banner on dashboards, notification prefs on `/profile`.

## 2. Senior notes

- **Persist first, then emit.** Clients dedupe by `clientId`, so a REST retry after a lost ack never doubles a message.
- **Unread count** = messages after `lastReadMessageId` not sent by me; computed by `createdAt` comparison (ids are cuids, not ordered).
- **No Redis**: single Socket.IO server is fine for one Render instance; typing throttle and presence are in-memory and lossy by design.
- **Large audiences**: an "all" notice to ~3,000 users = 3 batches of `NoticeRecipient` + `Notification` `createMany`; socket emits go to `user:<id>` rooms in a loop (cheap), push/email are queued jobs.
- **Never log message content** (CONV-06): the `msg:send` handler logs ids only; logger test extended.
- **Admin is not in group/section chats** — `sync()` desired-set never includes the Admin; test asserts.

## 3. Acceptance → tests

| ID | Test |
|---|---|
| CHAT-01 | `[CHAT-01] socket rejected without session; revoked disconnects; no events after leaving` |
| CHAT-02 | `[CHAT-02] direct pair rules` (matrix incl. Admin↔anyone) |
| CHAT-03 | `[CHAT-03] blocked cannot start/send direct; blocker hides their group messages` |
| CHAT-04 | `[CHAT-04] muted cannot send` (+ completes COMM-08) |
| CHAT-05 | `[CHAT-05] banned word 422 BLOCKED_WORD, nothing stored` |
| CHAT-06 | `[CHAT-06] membership sync on create, move, pass-out, mentor change, teacher change` |
| CHAT-07 | `[CHAT-07] admin not in group/section chats; sees only reported message ±10` |
| CHAT-08 | `[CHAT-08] unread counts and seen status direct + group` |
| CHAT-09 | `[CHAT-09] notice audience resolution central + class-wise` |
| CHAT-10 | `[CHAT-10] scheduled notice publishes once; expired hidden` |
| CHAT-11 | `[CHAT-11] quota: over limit waits for next day; high priority first` |
| CHAT-12 | `[CHAT-12] urgent email ignores pref; normal notices don't email` |
| CHAT-13 | `[CHAT-13] notif:new realtime with unread count; mark read` |
| CHAT-14 | `[CHAT-14] push payload has no content; 404/410 deletes subscription` (mock web-push) |
| CHAT-15 | Playwright `[CHAT-15] two browser contexts at 360 px, < 1 s, typing, Seen` |
| CHAT-16 | Playwright `[CHAT-16] urgent banner until read; notices filter + unread` |

## 4. Definition of done (M9)

"Chat < 1 s locally; email queue respects daily limit"; all CHAT IDs green; `cms-security-review` on sockets and chat; `/spec-check 07` complete.
