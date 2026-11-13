# Plan 09 · Book Shop & AI Study Assistant (Milestone M10)

Spec: `docs/spec/09-bookshop-ai.md` · PRD §5.19, §5.20. Skill: `cms-files-ai`. Agent: `senior-developer`.
Client decisions: **Groq is the AI provider; Gemini is not used.** Students may be minors; no extra age rules. No payment gateway.
Depends on M6 (storage, materials) and M7 (`hasLiveAttempt`).

## 1. Book shop — build order

1. **Catalog (Admin)**: multipart create (cover → public bucket, PDF ≤ 50 MB → private bucket, `previewPages` string parsed and validated like `1-5,9`). `book.make_preview` job: lazy-import `pdf-lib`, load PDF, validate pages against page count, copy pages to a new PDF → private bucket → `previewPdfId` → `publishedAt`. Large PDFs: stream the download from Supabase into a buffer once; the job runs with concurrency 1 (RAM).
2. Edit (new PDF = new object + rebuilt preview, never overwrite), archive (owners keep access), purchases list + top report + CSV.
3. **Student**: list (published, not archived, `unlocked` flag), details with signed preview URL, `pay` → `books/payment.ts` `unlock(studentId, bookId)` inserts `BookPurchase` with price snapshot and `unlocked_no_gateway` (unique; repeat returns existing), My Books, full PDF route **only with a purchase** → signed URL, else 403.
4. Public landing endpoint: 8 covers + titles (public bucket URLs only).
5. **Screens**: `/student/books` (grid, search, filters), details + preview reader, Pay confirm sheet, My Books, reader (react-pdf lazy, page-on-demand, one-handed controls), Admin catalog/purchases/reports.

## 2. AI assistant — build order

1. **Provider adapter** `ai/provider.ts`: `ChatProvider.stream(messages, opts)`; `GroqProvider` with `groq-sdk`, 30 s timeout via `AbortController`, `max_tokens` ~1,024. Provider + model from Settings (`ai_provider`, `ai_model`), cached 60 s. A `FakeProvider` for tests (records the prompt it received — used for AI-05).
2. **Grounding**: `material.extract_text` job (if not built in M6): `pdfjs-dist` legacy build in Node, lazy-imported; ~1,500-char chunks on paragraph boundaries; store `MaterialChunk(courseId)`; skip scanned (no text). Query with `websearch_to_tsquery('simple', $q)` limited to the student's active-enrollment course ids and materials they can open (reuse `materialVisibility`), top 3, wrapped in `<notes>` ≤ 3k chars. Delete chunks with the material.
3. **Pipeline** (`ai/service.ts`, order is the spec's §2.3): rate limit 6/min → live-exam block `423` → daily limit single-statement upsert (`… WHERE message_count < :limit RETURNING`) → save user message → build prompt (system prompt §2.5 + notes + last 12 messages trimmed to ~6k tokens with a cheap char/4 estimate) → stream from provider → save assistant message + token count + title → on provider error: refund (`message_count - 1`), `503 AI_BUSY` friendly text, never raw errors.
4. **Prompt builder is a pure function** `buildPrompt({ question, history, notes })` that has **no access to the user object** — the type signature itself makes AI-05 hard to break.
5. **Streaming**: `text/event-stream` from Express; disable compression for that route, flush per chunk, heartbeat comment every 15 s; client uses `fetch` + `ReadableStream` (EventSource can't POST or send the CSRF header).
6. Conversations CRUD (own only, 404 otherwise), usage `me`, Admin usage counts per day/section only (no content).
7. **Screens**: floating AI button + `/student/ai` list + `/student/ai/[id]` chat (Markdown without raw HTML via `react-markdown` + `remark-math` + `rehype-katex`, code blocks; all lazy on this route only), disclaimer always visible, usage counter, delete conversation.

## 3. Senior notes

- **Privacy**: AI tables never joined into Student 360° or any teacher/Admin route; a grep test asserts `aIConversation`/`aIMessage` are referenced only in `modules/ai` and the anonymise service (03 §5.5). Log redaction: never log prompt/answer.
- **Prompt injection**: notes are wrapped in `<notes>` and the system prompt says to treat them as reference only; student text is never placed in the system role.
- **Groq free tier**: check RPM/TPM limits in the console before launch; the per-user 6/min limit and daily 20 keep the college within it. One account only, never rotate accounts.
- The API key exists only in `apps/api` config; a build test greps the Next.js output for `GROQ` and fails if found (AI-08).

## 4. Acceptance → tests

| ID | Test |
|---|---|
| BOOK-01 | `[BOOK-01] full PDF denied without purchase` |
| BOOK-02 | `[BOOK-02] preview contains only chosen pages` (generate a 10-page fixture, assert page count + text) |
| BOOK-03 | `[BOOK-03] pay idempotent, price snapshot, no gateway call` |
| BOOK-04 | `[BOOK-04] only admin manages catalog; archived readable for owners` |
| BOOK-05 | Playwright `[BOOK-05] browse → pay → reader opens → My Books at 360 px` |
| AI-01 | `[AI-01] non-students 403` |
| AI-02 | `[AI-02] daily limit exact under concurrency (Dhaka date)` — 25 parallel requests with limit 20 → exactly 20 succeed |
| AI-03 | `[AI-03] blocked during in-progress attempt` |
| AI-04 | `[AI-04] provider error → busy message, count refunded` |
| AI-05 | `[AI-05] built prompt has no name/ID/phone/section` (FakeProvider capture) |
| AI-06 | `[AI-06] grounding only from own courses` |
| AI-07 | `[AI-07] teachers/admin cannot read AI chats; admin sees counts only` |
| AI-08 | `[AI-08] provider/model from Settings; key never in browser bundle` |
| AI-09 | Playwright `[AI-09] streaming, math renders, disclaimer, open/delete chats` (FakeProvider in e2e env) |

## 5. Definition of done (M10)

"Full PDF never served without a purchase; AI daily limit enforced"; all BOOK and AI IDs green; one manual run against the real Groq API with the configured model; `cms-security-review` on files + AI; `/spec-check 09` complete.
