# 08 · Online Classes, Recordings, Notes & Previous Questions

Source: PRD §5.11, §5.12, §5.13, §5.16. File rules: 00 §7. Skill: `cms-files-ai`.
No video hosting, no video room, no paid service (PRD §1.3).

## 1. Online classes (PRD §5.11)

| Route | Who | Rules |
|---|---|---|
| `POST /api/classes/online` | teacher of every listed offering | `{ offeringIds[] (≥1), title, topic?, description?, startAt (future), durationMin (15–240), joinUrl }`. `joinUrl` must be `https://`; platform detected: `meet.google.com` → meet, `meet.jit.si` → jitsi, else other. Attach/create Class Meetings (04 §5). Notify enrolled students `online_class_scheduled`. Schedule jobs: reminder at start − 15 min, status `live` at start, `ended` at start + duration. |
| `PATCH /api/classes/online/:id` | teacher | Reschedule / change link / title. Re-links meetings, re-schedules jobs, notifies `online_class_changed`. |
| `POST /api/classes/online/:id/cancel` | teacher | `status=cancelled`, detach meetings (04 §5), notify. |
| `GET /api/classes/online?offeringId&status` | teacher (own), enrolled students, mentor (section), Admin | Students get `joinUrl` **only** if enrolled in one of the offerings; otherwise omitted. |
| `POST /api/classes/online/:id/join` | enrolled student | Allowed from `startAt − 10 min` until `startAt + duration` and not cancelled (`409 JOIN_NOT_OPEN`). Logs `OnlineClassJoin`, returns `{ joinUrl }`; the client opens it in a new tab (`noopener`). |
| `GET /api/classes/online/:id/joins` | teacher, mentor, Admin | Who clicked Join and when (pre-fills attendance, 04 §6.1). |

Status is also derived on read from time (so a sleeping server never shows a stale status). UI shows the free-tool note (Meet ~60 min on personal accounts; Jitsi no limit).

## 2. Recorded classes (PRD §5.12)

| Route | Who | Rules |
|---|---|---|
| `POST /api/materials/recordings` | teacher (own offering), mentor (own section's offerings), Admin (any course, college-wide) | `{ courseOfferingId? , courseId, chapterId?, title, description?, url, visibility: section|college }`. URL parsing: YouTube (`youtube.com/watch?v=`, `youtu.be/`, `youtube.com/shorts/`, `/live/`) → `videoId`; Google Drive (`drive.google.com/file/d/<id>`) → `videoId`. Other hosts → `400 UNSUPPORTED_VIDEO_URL`. Chapter must belong to the course. Notify enrolled students (`recording_new`); college visibility notifies nobody extra. |
| `PATCH/DELETE /api/materials/recordings/:id` | creator or Admin | Soft delete. |
| `GET /api/materials/recordings?courseId&chapterId&q&scope=mine|free` | students: own offerings + `college` visibility; teachers/mentors/Admin in scope | Includes `watched` for the student. |
| `POST /api/materials/recordings/:id/opened` | student | Upsert `RecordingProgress` (first/last opened) → "watched". |

Embed: `https://www.youtube-nocookie.com/embed/<id>` / `https://drive.google.com/file/d/<id>/preview` in an `<iframe>` with `allow="encrypted-media; picture-in-picture; fullscreen"`, lazy-loaded. CSP `frame-src` allows only these two hosts.

## 3. Notes & study materials (PRD §5.13)

| Route | Who | Rules |
|---|---|---|
| `POST /api/materials` (multipart) | teacher: `scope=offering` (own); mentor: `scope=section` (own section); Admin: `scope=group|college` (or any) | `{ scope, courseOfferingId?/sectionId?/groupId?, courseId?, chapterId?, title, description?, linkUrl?, files[] ≤ 10 (PDF, DOC/DOCX, PPT/PPTX ≤ 20 MB; images ≤ 5 MB) }`. Notify audience (`material_new`). PDFs queue `material.extract_text` (09 §2.6). |
| `PATCH/DELETE /api/materials/:id` | creator, Admin | Soft delete; file objects marked deleted. |
| `GET /api/materials?courseId&chapterId&scope` | student: offerings they're enrolled in + their section + their group + college; staff: in scope | Grouped course → chapter. |
| `GET /api/materials/:id/files/:fileId?action=view|download` | same visibility | Permission check → `MaterialView` row → `302` to a 5-minute signed URL (`download` adds `Content-Disposition`). PDFs/images viewable in browser; DOC/PPT download. |
| `GET /api/materials/:id/stats` | creator, Admin | View and download counts (unique users + total). |

Chapters: picked from the course list (03 §3); no free text.
Free book PDFs from v1.0 live here as `scope=college` materials (PRD §5.19).

## 4. Previous-year questions (PRD §5.16)

| Route | Who | Rules |
|---|---|---|
| `POST /api/materials/previous-questions` (multipart) | Admin, mentors, teachers (courses they teach) | `{ courseId, year (1990–current+1), examType, board?, files[] (PDF or images ≤ 10), solution? (PDF) }`. |
| `GET /api/materials/previous-questions?courseId&year&examType&q` | all logged-in (students: courses of their group/class + common) | Browse course → year → exam type; filters. |
| `GET /api/materials/previous-questions/:id/files/:fileId` | same | Signed URL (as §3). |
| `PATCH/DELETE` | uploader, Admin | Soft delete. |

## 5. Tests

- Non-enrolled student never receives `joinUrl`; Join outside the 10-minute window rejected; join logged.
- Online class at a routine time attaches to that meeting (no duplicate meeting).
- Recording URL parser: valid YouTube/Drive forms accepted, others rejected; chapter from another course rejected.
- Student cannot list or open materials of another section's offering; signed URL only after the check; view/download counted.
- File type checked by content (a `.pdf` that is really an EXE is rejected).
