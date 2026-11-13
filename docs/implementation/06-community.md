# Plan 06 · Community: Feed, Pins, Comments, Moderation, Public Profile (Milestone M8)

Spec: `docs/spec/06-community.md` · PRD §5.7, §2.1, `docs/dashboards.md` §5. Agents: `api-builder`, `web-builder`.
Goal: a fast college-wide feed with the pinned-post rules exactly as the PRD says, and moderation tools for the single Admin.

## 1. Build order

1. **Shared building blocks** (reused by chat in M9):
   - `bannedWords.match(text)`: NFC + lower-case, Unicode-aware whole-word regex (`(?<![\p{L}\p{N}])word(?![\p{L}\p{N}])`, flag `u`), compiled once and cached until the list changes. Bangla test cases (CONV/OPS Bangla requirement).
   - `activeMute(userId)` cached per request; `MUTED` 403 with `endsAt`.
   - `AuthorLine` serializer (§2) — one function used by posts, comments, chat, notices (COMM-13).
2. **Posts** (§2): multipart create (≤ 10 images 5 MB, 1 PDF 20 MB, through `lib/storage.ts`), banned word → `held`, edit (no pin/timer change), author soft delete, single post, user posts.
3. **Pins** (§3.1–3.2): only Admin or Section Mentor, only at creation (`pin: true` from others → 400), `pinAudience` + `pinSectionId` snapshot at creation, `pinnedUntil = createdAt + Settings.pin_days`. Held pinned posts become visible on approval with the original timer. Notify audience (`pinned_post`) — on publish, or on approval for held posts. Admin unpin/extend.
4. **Feed query** (§3.3) — the riskiest query; write it as raw SQL:
   - `pinned` (first page only): published, `pinned_until > now()`, audience match, `NOT EXISTS post_views`, ordered admin pins → mentor pins, newest first.
   - `items`: published posts newest first with keyset cursor `(created_at, id)`, excluding ids in this request's `pinned`.
   - Batch-load media, reaction counts, `myReaction`, comment counts in 3 grouped queries (no N+1). Target < 150 ms server time for 20 posts.
   - `GET /api/feed/pinned` for the dashboard reuses the same query function.
5. **Seen** (§3.4): `POST /api/feed/seen { postIds[] }` → `INSERT … ON CONFLICT DO NOTHING`.
6. **Reactions & comments** (§4): reaction upsert/delete for posts and comments; comments with one reply level (`parentCommentId` must be top-level of the same post); aggregated reaction notification (≤ 1 per post per 10 min, checked via the latest notification row); comment/reply notifications.
7. **Reports** (§5): unique per reporter per target; message reports check conversation membership (completed in M9 when messages exist; until then `message` target returns 404).
8. **Moderation** (§6): grouped queue (reports + held items), actions dismiss/delete/delete_warn/mute/approve, sanction lift, direct Admin delete, banned-word CRUD + toggle, everything audited, author notified. Hard delete after 30 days is the `storage.purge` job (11).
9. **Public profile** (§7) with a dedicated serializer: never email, mobile, address, DOB, guardian, Student ID; inactive/passed-out → name + photo + note; deleted → 404.
10. **Screens**: `/feed` (PinnedStack 5 expanded + "Show N more announcements", PostCard, composer sheet with pin toggle default on for Admin/mentor, image grid lazy), `/feed/posts/[id]`, comment thread, `/u/[id]`, `/admin/moderation` (queue + banned words), dashboard pinned widget.

## 2. Senior notes

- **`useSeenTracker`**: one shared `IntersectionObserver` (threshold 0.5) for all pinned cards; a per-card timer that starts when ratio ≥ 0.5 and resets when it drops; collapsed cards are not mounted in the observer. Seen ids are batched and flushed every 2 s and on `visibilitychange`. The card is **not** removed until the next load (PRD).
- **Feed cache on the client:** TanStack infinite query; `pinned` lives only on page 0.
- **Signed URLs for post images** are generated in bulk per page (Supabase `createSignedUrls`) — one storage call per page, not per image.
- Removed content: excluded from every non-Admin query by a single `visibleContent(actor)` where-builder.
- Pins are by `createdAt`, so editing never re-pins (COMM-04) — guaranteed because `PATCH` schema has no pin fields.

## 3. Acceptance → tests

| ID | Test |
|---|---|
| COMM-01 | `[COMM-01] feed order admin pins → own-section mentor pins → rest newest first` |
| COMM-02 | `[COMM-02] seen pin leaves top on next load; one PostView for feed + dashboard` |
| COMM-03 | `[COMM-03] pin > 7 days not on top, stays in timeline; no pins → regular first` (fake clock) |
| COMM-04 | `[COMM-04] extend helps only unseen; edit doesn't reset timer/re-pin` |
| COMM-05 | `[COMM-05] section pins only for that section; mentor change keeps old audience` |
| COMM-06 | `[COMM-06] non-mentor teacher/student cannot pin; pin only at creation` |
| COMM-07 | `[COMM-07] one reply level; one reaction per user, changeable/removable` |
| COMM-08 | `[COMM-08] muted cannot post/comment (message in M9) but can read` |
| COMM-09 | `[COMM-09] banned word → held, visible to author + admin only` |
| COMM-10 | `[COMM-10] public profile no private fields (snapshot); inactive note; deleted 404` |
| COMM-11 | `[COMM-11] moderation actions notify, soft-delete 30 days, audited` |
| COMM-12 | `[COMM-12] max 10 images of 5 MB` |
| COMM-13 | `[COMM-13] author line formats` |
| COMM-14 | `[COMM-14] pinned post notifies audience; unpinned none` |
| COMM-15 | Playwright `[COMM-15] seen after ≥50% for 1 s; collapsed not counted; 5 + Show N more` (intercept `/feed/seen`) |

## 4. Definition of done (M8)

"Pin/seen/feed-order tests pass"; all COMM IDs green (COMM-08 message clause completed in M9); feed first page measured < 2 s on throttled 4G locally; `/spec-check 06` complete.
