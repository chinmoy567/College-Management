# 06 · Community: Feed, Pins, Comments, Moderation, Public Profile

Source: PRD §5.7, §2.1, `dashboards.md` §5.

## 1. Visibility

All active users (Admin, teachers, students) see every `published` post and comment (college-wide feed). `held` content is visible only to its author (with a "Waiting for review" label) and the Admin. `removed` is visible only to the Admin moderation view for 30 days.

## 2. Posts

| Route | Rules |
|---|---|
| `POST /api/feed/posts` (multipart) | `{ text (1–5,000), tag?, linkUrl?, images[] (≤10, 5 MB each), pdf? (20 MB), pin? }`. Muted users → `403 MUTED` with end time. Banned-word check (§6.3) → `status=held`. |
| `PATCH /api/feed/posts/:id` | Author only: text, tag, link, add/remove media. Sets `editedAt`. Does **not** change pin timer or re-pin anyone. |
| `DELETE /api/feed/posts/:id` | Author → `removed` (soft). Admin → see §6. |
| `GET /api/feed` `?cursor&tag` | Ordered feed (§3). 20 per page. |
| `GET /api/feed/posts/:id` | Single post with first 20 comments. |
| `GET /api/feed/users/:id/posts` | Public profile posts list. |

Post payload: `{ id, author: AuthorLine, text, tag, link, media: [{ signedUrl, w, h }], pdf, reactionCounts, myReaction, commentCount, editedAt, createdAt, pin?: { badge, until } }`.

**AuthorLine** (PRD §5.7.1): `{ id, name, avatarUrl, role, line }` where `line` = student: `"2024–25 · Science · A"`; teacher: `"Teacher"` or `"Teacher · Section Mentor · 2024–25 Science-A"`; admin: `"Admin"`; inactive/passed-out: name + photo only, profile shows the inactive note; deleted: `{ name: "Deleted user", avatarUrl: null, id: null }`.

## 3. Pinned posts (PRD §5.7.2)

### 3.1 Creating
- `pin` is accepted only from the Admin or a Section Mentor; **default true** in the UI for them. Teachers who are not mentors and students cannot pin (`pin` ignored → 400 if true).
- Admin: `pinAudience=all`, `pinSectionId=null`. Mentor: `pinAudience=section`, `pinSectionId` = their section **at creation** (stored; unaffected by later mentor changes).
- `pinnedUntil = createdAt + Settings.pin_days (7)`.
- Pin can only be chosen at creation. A held (banned-word) pinned post becomes visible/pinned only after approval, timer still from `createdAt`.
- Notify the audience (`pinned_post`): Admin pin → all active users; mentor pin → active students of that section.

### 3.2 Admin controls
- `POST /api/feed/posts/:id/unpin` → `pinnedUntil = now` (off for everyone).
- `POST /api/feed/posts/:id/extend` `{ days 1–30 }` → `pinnedUntil = max(pinnedUntil, now) + days`. Users with a `PostView` never get it back on top (they are filtered by PostView).
- Admin may unpin/extend any pinned post, including mentor pins. Mentors cannot extend.

### 3.3 Feed query

```
pinnedForMe = posts p WHERE p.status = published AND p.pinnedUntil > now
              AND (p.pinAudience = all OR (p.pinAudience = section AND p.pinSectionId = me.student.sectionId))
              AND NOT EXISTS (PostView v WHERE v.postId = p.id AND v.userId = me)
order: Admin pins (author role admin) newest first, then mentor pins newest first
```

- Only the **first page** (no cursor) returns `pinned: [...]` (all of them; the UI shows 5 expanded and "Show N more announcements"). `items` = all other published posts newest first, **excluding** posts currently in `pinned` for this request (they appear in the timeline at their original date once seen).
- Section pins only apply to students of that section; everyone else sees them only in the normal timeline.
- If `pinned` is empty, the feed starts directly with regular posts.
- The dashboard widget calls `GET /api/feed/pinned` (same query).

### 3.4 Seen
- Browser: `IntersectionObserver` threshold 0.5 on each pinned card; when continuously ≥ 50% visible for 1,000 ms, call `POST /api/feed/posts/:id/seen` (batched: `POST /api/feed/seen { postIds[] }`). Collapsed cards ("Show N more") are not observed.
- Server: upsert `PostView` (insert-if-absent). Idempotent.
- The client does **not** remove the card on seen; it stays until the next load/refresh (PRD).

## 4. Reactions & comments

| Route | Rules |
|---|---|
| `PUT /api/feed/posts/:id/reaction` `{ type }` / `DELETE` | One per user per post (upsert = change). Same for comments: `/api/feed/comments/:id/reaction`. Notify post author (`reaction`), aggregated: at most one notification per post per 10 min. |
| `POST /api/feed/posts/:id/comments` (multipart) | `{ text (1–2,000), parentCommentId?, linkUrl?, images[] ≤ 10, pdf? }`. `parentCommentId` must be a top-level comment of the same post (one level of replies). Muted → 403. Banned words → held. Notify post author (and parent comment author for replies). |
| `PATCH/DELETE /api/feed/comments/:id` | Author edit (`editedAt`) / soft delete. |
| `GET /api/feed/posts/:id/comments?cursor` | Top-level newest-last with first 3 replies each; `GET /api/feed/comments/:id/replies`. |

`commentCount` counts published comments + replies.

## 5. Reports

`POST /api/reports` `{ targetType: post|comment|message|user, targetId, reason (enum: spam, harassment, inappropriate, other + text ≤ 500) }` — one per reporter per target (unique). Message reports: the reporter must be a member of that conversation (07 §4).

## 6. Moderation (Admin)

### 6.1 Queue
`GET /api/admin/moderation?status=open&type` → grouped by target: content preview, reasons, reporter count, author, created. Held (banned-word) items appear in the same queue as type `held`.

Actions `POST /api/admin/moderation/:targetType/:targetId` `{ action: dismiss | delete | delete_warn | mute, days?, reason }`:
- **dismiss**: reports → `dismissed`.
- **delete**: content `status=removed, removedAt, removedBy`; reports → `actioned`; author notified (`content_removed`). Kept 30 days, then a nightly job hard-deletes the row and marks its files deleted.
- **delete_warn**: delete + `UserSanction(warn)` + warning notification.
- **mute**: `UserSanction(mute, endsAt = now + days)`; muted user cannot create posts, comments or chat messages (all chats) until `endsAt`; can read. `POST /api/admin/sanctions/:id/lift` ends early.
- Held items: `approve` (→ published) or `delete`.
- Admin can also delete any post/comment directly (`DELETE` with Admin actor = `removed` + notify).
- Every action → AuditLog.

### 6.2 Mute check
`activeMute(userId)` = `UserSanction` type mute, `liftedAt` null, `startsAt <= now < endsAt`. Checked on every create (post, comment, message). Cached per request.

### 6.3 Banned words
- Admin CRUD: `GET/POST/DELETE /api/admin/banned-words`; toggle `Settings.banned_words_enabled`.
- Match: NFC-normalise + lower-case text, whole-word match (Unicode word boundaries via `\p{L}` aware regex; Bangla supported). Posts/comments → held for review. Chat → rejected (07 §2.2).

## 7. Public profile (PRD §5.7.1)

`GET /api/users/:id/public` (any logged-in user):
- Active: `{ name, avatarUrl, role, sessionGroupSection + class (students), coursesTaught: [course names] (teachers), mentorOf (teachers), bio, recentPosts (via /feed/users/:id/posts) }`.
- **Never** email, mobile, address, DOB, guardian, **Student ID**.
- Passed-out / inactive: `{ name, avatarUrl, inactiveNote: "This account is no longer active." }` only.
- Deleted: `404`.
- When the actor is the Admin, the UI links to Student 360° instead.

## 8. Acceptance

- **COMM-01** Feed order: unseen Admin pins → unseen mentor pins (own section only) → all other posts, newest first.
- **COMM-02** A seen pin leaves the top on the next load (not instantly); one PostView covers both feed and dashboard.
- **COMM-03** A pin older than 7 days is never on top and the post stays in the timeline; with no unseen pins the feed starts with regular posts.
- **COMM-04** Extending a pin helps only users who have not seen it; editing a post does not reset the timer or re-pin it.
- **COMM-05** Section pins appear on top only for that section's students; a mentor change keeps the old pin's audience.
- **COMM-06** Non-mentor teachers and students cannot pin; pinning can be chosen only at creation.
- **COMM-07** Replies are one level only; one reaction per user per post/comment, changeable and removable.
- **COMM-08** A muted user cannot post, comment or message but can still read.
- **COMM-09** A post/comment with a banned word is held for review and visible only to its author and the Admin.
- **COMM-10** Public profile never contains email, mobile, address, DOB, guardian info or Student ID; inactive users show only photo, name and the note; deleted users give 404.
- **COMM-11** Moderation actions dismiss / delete / delete & warn / mute work, notify the author, soft-delete for 30 days and are audited.
- **COMM-12** Posts and comments accept at most 10 images of 5 MB each.
- **COMM-13** Author line format matches PRD §5.7.1 for student, teacher, mentor, Admin and deleted user.
- **COMM-14** Creating a pinned post notifies its audience; an unpinned post sends no notification.
- **COMM-15** (UI) A pin counts as seen only after ≥ 50% is visible for 1 s; collapsed pins are not counted; 5 pins shown expanded with "Show N more announcements".
