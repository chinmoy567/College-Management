---
name: cms-files-ai
description: Handle file uploads, Supabase Storage, signed URLs, book previews and the Groq AI study assistant for the College Management System.
---

# CMS files and AI

Source: `PRD.md` §5.19 books, §5.20 AI, §8 limits, `tech.stack.md` §5-6.

## Files
- Upload via multer (memory). Check the real type with `file-type` (not the extension or header) and the size limits from PRD §8. Supabase free allows 50 MB per file.
- Resize images with sharp. Use random storage keys, never user filenames.
- Buckets: `public` (logo, banner, notice files, covers); `private` (avatars, posts, chat files, notes, questions, book PDFs and previews).
- Private files are served only by signed URLs that expire in minutes, created after a permission check.
- Books: previews are separate PDFs cut with pdf-lib; the full PDF is reachable only by entitled students.
- The `service_role` key stays server-side.

## AI chat (Groq, server-side only)
- Groq is the provider (its terms allow minors); never Gemini. Model name comes from Settings. Key only in server env.
- Rate-limit per user, cap prompt and response size, scope the system prompt to study help, store history per the PRD.
- Handle Groq errors and timeouts with a friendly message; never expose raw provider errors or the key.
- No extra age-based rules (client decision).
