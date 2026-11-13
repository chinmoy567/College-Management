# Plan 08 · Online Classes, Recordings, Notes & Previous Questions (Milestone M6)

Spec: `docs/spec/08-learning-content.md` · PRD §5.11–5.13, §5.16 · file rules 00 §7. Skill: `cms-files-ai`. Agent: `senior-developer`.
No video hosting, no video rooms, no paid service. This milestone also **completes the file storage layer** (documents, purge) used by every later module.

## 1. Build order

1. **Finish `lib/storage.ts`** (00 §7):
   - `upload(buffer, { purpose, allowed, maxBytes, bucket })`: `file-type` on the buffer (never trust extension or MIME header) → allow-list → images through sharp (rotate, 1600 px, WebP q80, strip metadata) → key `<purpose>/<yyyy>/<mm>/<cuid>.<ext>` → Supabase upload with `upsert: false` → `StorageObject` row.
   - DOC/DOCX/PPT/PPTX: `file-type` detects OOXML as zip/`docx`; legacy `.doc/.ppt` as `cfb` — accept `cfb` only when the declared extension is doc/ppt.
   - `signedUrl(objectId, { expiresIn: 300, download? })`, `publicUrl()`; office files always `download` (Content-Disposition attachment).
   - `markDeleted(objectId)`; the `storage.purge` job (11) removes from storage after 30 days.
   - multer per-route limits (memory storage), plus a per-user upload rate limit (60/hour).
2. **Online classes** (§1): create for ≥ 1 offerings (teacher of every one), `https://` only, platform detection, attach/create meetings via 04's `attachOrCreateMeeting`, notify `online_class_scheduled`, jobs `online_class.remind` (start − 15) and status changes. Reschedule re-links + re-schedules + notifies; cancel detaches. List hides `joinUrl` unless enrolled (LRN-01). Join window `startAt − 10 min … startAt + duration` → `OnlineClassJoin` row → `{ joinUrl }`. Joins list for staff. Status derived on read from time.
3. **Recordings** (§2): URL parser (`youtube.com/watch?v=`, `youtu.be/`, `/shorts/`, `/live/`, `drive.google.com/file/d/<id>`) as a pure unit-tested function; else `UNSUPPORTED_VIDEO_URL`. Chapter must belong to the course. Visibility section/college. Notify enrolled students. `opened` → `RecordingProgress` → watched flag.
4. **Materials** (§3): scope rules (teacher: own offering; mentor: own section; Admin: group/college/any), up to 10 files, visibility query (`offering I'm enrolled in OR my section OR my group OR college`), file access route = permission check → `MaterialView` → 302 to 5-minute signed URL; stats endpoint. PDFs enqueue `material.extract_text` (handler body in M10; job registered now as a no-op that M10 fills, or build it now — cheap and decoupled).
5. **Previous questions** (§4): upload by Admin, mentors, teachers of the course; browse course → year → exam type; students see courses of their group/class + common.
6. **Screens**: teacher course workspace tabs (classes · recordings · notes) with create sheets and upload progress; student `/student/live` (Join opens new tab `noopener`, free-tool note), `/student/recordings` (lazy `youtube-nocookie` / Drive preview iframe, watched badge), `/student/notes` grouped course → chapter, `/student/previous-questions` with filters; Admin college-wide upload pages.

## 2. Senior notes

- **CSP**: `frame-src` only `www.youtube-nocookie.com` and `drive.google.com`; `img-src`/`connect-src` include the Supabase domain (configured in 11 but verified here because embeds land now).
- **Never proxy file bytes through Express** (RAM on the free plan): always redirect to a signed URL.
- **Visibility is one query builder** (`materialVisibility(actor)`) used by list *and* file access, so they can't disagree (LRN-05).
- The renamed-EXE test (LRN-06) uses a real PE header buffer with `.pdf` name.
- Timezone: online class `startAt` is a UTC instant; the meeting attachment compares on the **Dhaka date** and the period's local times.

## 3. Acceptance → tests

| ID | Test |
|---|---|
| LRN-01 | `[LRN-01] non-enrolled student never gets joinUrl` (snapshot) |
| LRN-02 | `[LRN-02] join only from start−10 to end; each click logged` |
| LRN-03 | `[LRN-03] reschedule/cancel notifies and re-links/detaches meetings` (+ completes SCH-13) |
| LRN-04 | `[LRN-04] URL parser accepts YouTube/Drive, rejects others; foreign chapter rejected` |
| LRN-05 | `[LRN-05] other section's materials 404; signed URL after check; views counted` |
| LRN-06 | `[LRN-06] content-type check (renamed exe rejected); size limits` |
| LRN-07 | `[LRN-07] college-wide visible to all; section only to that section` |
| LRN-08 | `[LRN-08] new recording/material notifies enrolled students` |
| LRN-09 | `[LRN-09] previous questions filters; upload roles per PRD §2.1` |
| LRN-10 | Playwright `[LRN-10] recording plays at 360 px, watched; Join opens new tab` |

Also now green: `[CONV-04]`, `[CONV-05]` (storage).

## 4. Definition of done (M6)

"Signed URLs only after permission check" (LRN-05, CONV-04); all LRN IDs green; `/spec-check 08` complete and `/spec-check 00` re-run for CONV-04/05.
