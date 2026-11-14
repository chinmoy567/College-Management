-- CreateEnum
CREATE TYPE "role" AS ENUM ('admin', 'teacher', 'student');

-- CreateEnum
CREATE TYPE "user_status" AS ENUM ('active', 'inactive', 'passed_out', 'deleted');

-- CreateEnum
CREATE TYPE "session_status" AS ENUM ('active', 'closed');

-- CreateEnum
CREATE TYPE "group_type" AS ENUM ('science', 'commerce', 'arts');

-- CreateEnum
CREATE TYPE "course_group" AS ENUM ('science', 'commerce', 'arts', 'common');

-- CreateEnum
CREATE TYPE "course_class" AS ENUM ('c11', 'c12', 'both');

-- CreateEnum
CREATE TYPE "paper" AS ENUM ('first', 'second', 'none');

-- CreateEnum
CREATE TYPE "enrollment_status" AS ENUM ('active', 'ended');

-- CreateEnum
CREATE TYPE "weekday" AS ENUM ('sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat');

-- CreateEnum
CREATE TYPE "meeting_status" AS ENUM ('scheduled', 'held', 'cancelled', 'removed');

-- CreateEnum
CREATE TYPE "attendance_status" AS ENUM ('present', 'absent', 'late', 'excused');

-- CreateEnum
CREATE TYPE "post_tag" AS ENUM ('general', 'problem', 'study', 'event');

-- CreateEnum
CREATE TYPE "content_status" AS ENUM ('published', 'held', 'removed');

-- CreateEnum
CREATE TYPE "pin_audience" AS ENUM ('all', 'section');

-- CreateEnum
CREATE TYPE "reaction_type" AS ENUM ('like', 'love', 'haha', 'wow', 'sad', 'angry');

-- CreateEnum
CREATE TYPE "report_target" AS ENUM ('post', 'comment', 'message', 'user');

-- CreateEnum
CREATE TYPE "report_status" AS ENUM ('open', 'dismissed', 'actioned');

-- CreateEnum
CREATE TYPE "conversation_type" AS ENUM ('direct', 'group', 'section');

-- CreateEnum
CREATE TYPE "notice_scope" AS ENUM ('central', 'class');

-- CreateEnum
CREATE TYPE "notice_priority" AS ENUM ('normal', 'important', 'urgent');

-- CreateEnum
CREATE TYPE "meet_platform" AS ENUM ('meet', 'jitsi', 'other');

-- CreateEnum
CREATE TYPE "online_class_status" AS ENUM ('scheduled', 'live', 'ended', 'cancelled');

-- CreateEnum
CREATE TYPE "video_source" AS ENUM ('youtube', 'drive');

-- CreateEnum
CREATE TYPE "recording_visibility" AS ENUM ('section', 'college');

-- CreateEnum
CREATE TYPE "material_scope" AS ENUM ('offering', 'section', 'group', 'college');

-- CreateEnum
CREATE TYPE "question_type" AS ENUM ('single', 'multiple');

-- CreateEnum
CREATE TYPE "exam_kind" AS ENUM ('exam', 'quiz');

-- CreateEnum
CREATE TYPE "exam_status" AS ENUM ('draft', 'published', 'closed');

-- CreateEnum
CREATE TYPE "result_mode" AS ENUM ('instant', 'manual');

-- CreateEnum
CREATE TYPE "attempt_status" AS ENUM ('in_progress', 'submitted', 'auto_submitted');

-- CreateEnum
CREATE TYPE "prev_exam_type" AS ENUM ('hsc_board', 'test', 'pre_test', 'half_yearly', 'model_test');

-- CreateEnum
CREATE TYPE "payment_status" AS ENUM ('unlocked_no_gateway');

-- CreateEnum
CREATE TYPE "ai_role" AS ENUM ('user', 'assistant');

-- CreateEnum
CREATE TYPE "token_purpose" AS ENUM ('password_reset', 'email_verify', 'email_change');

-- CreateEnum
CREATE TYPE "sanction_type" AS ENUM ('warn', 'mute');

-- CreateEnum
CREATE TYPE "view_action" AS ENUM ('view', 'download');

-- CreateEnum
CREATE TYPE "bucket" AS ENUM ('public', 'private');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "login_id" TEXT,
    "email" TEXT,
    "email_verified_at" TIMESTAMPTZ(6),
    "mobile" TEXT,
    "password_hash" TEXT,
    "role" "role" NOT NULL,
    "status" "user_status" NOT NULL DEFAULT 'active',
    "first_login" BOOLEAN NOT NULL DEFAULT true,
    "avatar_id" TEXT,
    "totp_secret_enc" TEXT,
    "totp_enabled_at" TIMESTAMPTZ(6),
    "totp_pending_secret_enc" TEXT,
    "totp_last_step" INTEGER,
    "backup_code_hashes" TEXT[],
    "must_change_password" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "anonymised_at" TIMESTAMPTZ(6),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_profiles" (
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_locked" BOOLEAN NOT NULL DEFAULT false,
    "section_id" TEXT NOT NULL,
    "roll" TEXT NOT NULL,
    "bio" TEXT,
    "dob" DATE,
    "address" TEXT,
    "guardian_name" TEXT,
    "guardian_contact" TEXT,
    "passed_out_at" TIMESTAMPTZ(6),

    CONSTRAINT "student_profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "teacher_profiles" (
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "designation" TEXT,
    "subjects" TEXT[],
    "bio" TEXT,

    CONSTRAINT "teacher_profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "login_sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(6),
    "ip" TEXT,
    "user_agent" TEXT,
    "step_up_pending" BOOLEAN NOT NULL DEFAULT false,
    "totp_failures" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "login_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "purpose" "token_purpose" NOT NULL,
    "new_email" TEXT,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_histories" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "identifier_hash" TEXT,
    "success" BOOLEAN NOT NULL,
    "ip" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_histories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_limit_hits" (
    "key" TEXT NOT NULL,
    "window_start" TIMESTAMPTZ(6) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "rate_limit_hits_pkey" PRIMARY KEY ("key","window_start")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "session_status" NOT NULL DEFAULT 'active',
    "closed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "groups" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "type" "group_type" NOT NULL,

    CONSTRAINT "groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sections" (
    "id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "class_level" SMALLINT NOT NULL,
    "name" TEXT NOT NULL,
    "mentor_teacher_id" TEXT,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courses" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "group_type" "course_group" NOT NULL,
    "class_level" "course_class" NOT NULL,
    "paper" "paper" NOT NULL DEFAULT 'none',
    "is_optional" BOOLEAN NOT NULL DEFAULT false,
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "courses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chapters" (
    "id" TEXT NOT NULL,
    "course_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "created_by_id" TEXT NOT NULL,

    CONSTRAINT "chapters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_offerings" (
    "id" TEXT NOT NULL,
    "section_id" TEXT NOT NULL,
    "course_id" TEXT NOT NULL,
    "teacher_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(6),

    CONSTRAINT "course_offerings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enrollments" (
    "id" TEXT NOT NULL,
    "course_offering_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "status" "enrollment_status" NOT NULL DEFAULT 'active',
    "enrolled_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(6),

    CONSTRAINT "enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "periods" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "start_time" TIME(0) NOT NULL,
    "end_time" TIME(0) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rooms" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "capacity" INTEGER,
    "building" TEXT,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "routine_slots" (
    "id" TEXT NOT NULL,
    "day" "weekday" NOT NULL,
    "period_id" TEXT NOT NULL,
    "room_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "routine_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "routine_slot_offerings" (
    "routine_slot_id" TEXT NOT NULL,
    "course_offering_id" TEXT NOT NULL,

    CONSTRAINT "routine_slot_offerings_pkey" PRIMARY KEY ("routine_slot_id","course_offering_id")
);

-- CreateTable
CREATE TABLE "routine_uploads" (
    "id" TEXT NOT NULL,
    "section_id" TEXT NOT NULL,
    "file_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "routine_uploads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "holidays" (
    "id" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "title" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "holidays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "special_days" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "title" TEXT NOT NULL,
    "session_id" TEXT,
    "period_ids" TEXT[],
    "created_by" TEXT NOT NULL,

    CONSTRAINT "special_days_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "class_meetings" (
    "id" TEXT NOT NULL,
    "routine_slot_id" TEXT,
    "online_class_id" TEXT,
    "date" DATE NOT NULL,
    "original_date" DATE,
    "manually_edited" BOOLEAN NOT NULL DEFAULT false,
    "period_id" TEXT,
    "room_id" TEXT,
    "start_time" TIME(0) NOT NULL,
    "end_time" TIME(0) NOT NULL,
    "teacher_id" TEXT NOT NULL,
    "substitute_teacher_id" TEXT,
    "status" "meeting_status" NOT NULL DEFAULT 'scheduled',
    "attendance_taken_at" TIMESTAMPTZ(6),
    "last_client_draft_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "class_meetings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "class_meeting_offerings" (
    "class_meeting_id" TEXT NOT NULL,
    "course_offering_id" TEXT NOT NULL,

    CONSTRAINT "class_meeting_offerings_pkey" PRIMARY KEY ("class_meeting_id","course_offering_id")
);

-- CreateTable
CREATE TABLE "attendance_records" (
    "id" TEXT NOT NULL,
    "class_meeting_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "section_id" TEXT NOT NULL,
    "course_offering_id" TEXT NOT NULL,
    "status" "attendance_status" NOT NULL,
    "marked_by" TEXT NOT NULL,
    "marked_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_edits" (
    "id" TEXT NOT NULL,
    "attendance_record_id" TEXT NOT NULL,
    "old_status" "attendance_status" NOT NULL,
    "new_status" "attendance_status" NOT NULL,
    "edited_by" TEXT NOT NULL,
    "edited_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_edits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "posts" (
    "id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "tag" "post_tag" NOT NULL DEFAULT 'general',
    "link_url" TEXT,
    "pdf_id" TEXT,
    "pinned_until" TIMESTAMPTZ(6),
    "pin_audience" "pin_audience",
    "pin_section_id" TEXT,
    "status" "content_status" NOT NULL DEFAULT 'published',
    "edited_at" TIMESTAMPTZ(6),
    "removed_at" TIMESTAMPTZ(6),
    "removed_by" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "post_media" (
    "id" TEXT NOT NULL,
    "post_id" TEXT NOT NULL,
    "file_id" TEXT NOT NULL,
    "order" INTEGER NOT NULL,

    CONSTRAINT "post_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "post_views" (
    "post_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "post_views_pkey" PRIMARY KEY ("post_id","user_id")
);

-- CreateTable
CREATE TABLE "comments" (
    "id" TEXT NOT NULL,
    "post_id" TEXT NOT NULL,
    "parent_comment_id" TEXT,
    "author_id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "link_url" TEXT,
    "status" "content_status" NOT NULL DEFAULT 'published',
    "edited_at" TIMESTAMPTZ(6),
    "removed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comment_media" (
    "id" TEXT NOT NULL,
    "comment_id" TEXT NOT NULL,
    "file_id" TEXT NOT NULL,
    "order" INTEGER NOT NULL,

    CONSTRAINT "comment_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reactions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "post_id" TEXT,
    "comment_id" TEXT,
    "type" "reaction_type" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" TEXT NOT NULL,
    "reporter_id" TEXT NOT NULL,
    "target_type" "report_target" NOT NULL,
    "target_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "report_status" NOT NULL DEFAULT 'open',
    "resolved_by" TEXT,
    "resolved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_sanctions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" "sanction_type" NOT NULL,
    "reason" TEXT NOT NULL,
    "related_report_id" TEXT,
    "starts_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ends_at" TIMESTAMPTZ(6),
    "lifted_at" TIMESTAMPTZ(6),
    "created_by" TEXT NOT NULL,

    CONSTRAINT "user_sanctions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "banned_words" (
    "id" TEXT NOT NULL,
    "word" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "banned_words_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blocks" (
    "blocker_id" TEXT NOT NULL,
    "blocked_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blocks_pkey" PRIMARY KEY ("blocker_id","blocked_id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "type" "conversation_type" NOT NULL,
    "ref_id" TEXT,
    "direct_key" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_message_at" TIMESTAMPTZ(6),

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_members" (
    "conversation_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "joined_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "left_at" TIMESTAMPTZ(6),
    "last_read_message_id" TEXT,

    CONSTRAINT "conversation_members_pkey" PRIMARY KEY ("conversation_id","user_id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "sender_id" TEXT NOT NULL,
    "text" TEXT,
    "attachment_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notices" (
    "id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "scope" "notice_scope" NOT NULL,
    "audience" JSONB NOT NULL,
    "title" TEXT NOT NULL,
    "body_html" TEXT NOT NULL,
    "priority" "notice_priority" NOT NULL DEFAULT 'normal',
    "show_on_landing" BOOLEAN NOT NULL DEFAULT false,
    "publish_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6),
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notice_attachments" (
    "id" TEXT NOT NULL,
    "notice_id" TEXT NOT NULL,
    "file_id" TEXT NOT NULL,

    CONSTRAINT "notice_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notice_recipients" (
    "notice_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,

    CONSTRAINT "notice_recipients_pkey" PRIMARY KEY ("notice_id","user_id")
);

-- CreateTable
CREATE TABLE "notice_reads" (
    "notice_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "read_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notice_reads_pkey" PRIMARY KEY ("notice_id","user_id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "ref_type" TEXT,
    "ref_id" TEXT,
    "text" TEXT NOT NULL,
    "read_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_prefs" (
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "email" BOOLEAN NOT NULL DEFAULT true,
    "push" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "notification_prefs_pkey" PRIMARY KEY ("user_id","type")
);

-- CreateTable
CREATE TABLE "push_subscriptions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_quotas" (
    "date" DATE NOT NULL,
    "sent" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "email_quotas_pkey" PRIMARY KEY ("date")
);

-- CreateTable
CREATE TABLE "online_classes" (
    "id" TEXT NOT NULL,
    "teacher_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "topic" TEXT,
    "description" TEXT,
    "start_at" TIMESTAMPTZ(6) NOT NULL,
    "duration_min" INTEGER NOT NULL,
    "platform" "meet_platform" NOT NULL,
    "join_url" TEXT NOT NULL,
    "status" "online_class_status" NOT NULL DEFAULT 'scheduled',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "online_classes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "online_class_offerings" (
    "online_class_id" TEXT NOT NULL,
    "course_offering_id" TEXT NOT NULL,

    CONSTRAINT "online_class_offerings_pkey" PRIMARY KEY ("online_class_id","course_offering_id")
);

-- CreateTable
CREATE TABLE "online_class_joins" (
    "id" TEXT NOT NULL,
    "online_class_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "clicked_join_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "online_class_joins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recorded_classes" (
    "id" TEXT NOT NULL,
    "course_id" TEXT NOT NULL,
    "course_offering_id" TEXT,
    "chapter_id" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "video_source" "video_source" NOT NULL,
    "url" TEXT NOT NULL,
    "video_id" TEXT,
    "visibility" "recording_visibility" NOT NULL DEFAULT 'section',
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "recorded_classes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recording_progress" (
    "recorded_class_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "first_opened_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_opened_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recording_progress_pkey" PRIMARY KEY ("recorded_class_id","student_id")
);

-- CreateTable
CREATE TABLE "materials" (
    "id" TEXT NOT NULL,
    "scope" "material_scope" NOT NULL,
    "course_id" TEXT,
    "course_offering_id" TEXT,
    "section_id" TEXT,
    "group_id" TEXT,
    "chapter_id" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "link_url" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_files" (
    "id" TEXT NOT NULL,
    "material_id" TEXT NOT NULL,
    "file_id" TEXT NOT NULL,
    "order" INTEGER NOT NULL,

    CONSTRAINT "material_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_chunks" (
    "id" TEXT NOT NULL,
    "material_id" TEXT NOT NULL,
    "course_id" TEXT,
    "chunk_no" INTEGER NOT NULL,
    "content" TEXT NOT NULL,

    CONSTRAINT "material_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_views" (
    "id" TEXT NOT NULL,
    "material_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "action" "view_action" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "material_views_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "previous_questions" (
    "id" TEXT NOT NULL,
    "course_id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "exam_type" "prev_exam_type" NOT NULL,
    "board" TEXT,
    "file_ids" TEXT[],
    "solution_id" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "previous_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "questions" (
    "id" TEXT NOT NULL,
    "teacher_id" TEXT NOT NULL,
    "course_id" TEXT NOT NULL,
    "chapter_id" TEXT,
    "type" "question_type" NOT NULL,
    "text" TEXT NOT NULL,
    "options" JSONB NOT NULL,
    "correct" JSONB NOT NULL,
    "marks" DECIMAL(6,2) NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exams" (
    "id" TEXT NOT NULL,
    "course_offering_id" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "kind" "exam_kind" NOT NULL,
    "title" TEXT NOT NULL,
    "instructions" TEXT,
    "start_at" TIMESTAMPTZ(6) NOT NULL,
    "end_at" TIMESTAMPTZ(6) NOT NULL,
    "duration_min" INTEGER NOT NULL,
    "total_marks" DECIMAL(6,2) NOT NULL,
    "pass_marks" DECIMAL(6,2) NOT NULL,
    "max_attempts" INTEGER NOT NULL DEFAULT 1,
    "shuffle_questions" BOOLEAN NOT NULL DEFAULT false,
    "shuffle_options" BOOLEAN NOT NULL DEFAULT false,
    "show_answers_after_end" BOOLEAN NOT NULL DEFAULT true,
    "result_mode" "result_mode" NOT NULL DEFAULT 'instant',
    "status" "exam_status" NOT NULL DEFAULT 'draft',
    "published_at" TIMESTAMPTZ(6),
    "results_published_at" TIMESTAMPTZ(6),
    "revealed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "exams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_questions" (
    "id" TEXT NOT NULL,
    "exam_id" TEXT NOT NULL,
    "question_id" TEXT,
    "order" INTEGER NOT NULL,
    "type" "question_type" NOT NULL,
    "text" TEXT NOT NULL,
    "options" JSONB NOT NULL,
    "correct" JSONB NOT NULL,
    "marks" DECIMAL(6,2) NOT NULL,
    "chapter_id" TEXT,
    "is_cancelled" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "exam_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_attempts" (
    "id" TEXT NOT NULL,
    "exam_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "attempt_no" INTEGER NOT NULL,
    "section_id" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deadline_at" TIMESTAMPTZ(6) NOT NULL,
    "extra_minutes" INTEGER NOT NULL DEFAULT 0,
    "question_order" JSONB NOT NULL,
    "submitted_at" TIMESTAMPTZ(6),
    "score" DECIMAL(6,2),
    "status" "attempt_status" NOT NULL DEFAULT 'in_progress',
    "integrity_log" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "exam_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attempt_extensions" (
    "id" TEXT NOT NULL,
    "attempt_id" TEXT NOT NULL,
    "minutes" INTEGER NOT NULL,
    "reopened" BOOLEAN NOT NULL DEFAULT false,
    "given_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attempt_extensions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "answers" (
    "attempt_id" TEXT NOT NULL,
    "exam_question_id" TEXT NOT NULL,
    "selected_option_ids" TEXT[],
    "marked_for_review" BOOLEAN NOT NULL DEFAULT false,
    "is_correct" BOOLEAN,
    "marks_awarded" DECIMAL(6,2),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "answers_pkey" PRIMARY KEY ("attempt_id","exam_question_id")
);

-- CreateTable
CREATE TABLE "exam_change_logs" (
    "id" TEXT NOT NULL,
    "exam_id" TEXT NOT NULL,
    "exam_question_id" TEXT NOT NULL,
    "change" JSONB NOT NULL,
    "changed_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exam_change_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "books" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "publisher" TEXT,
    "course_id" TEXT,
    "group_type" "course_group",
    "class_level" "course_class",
    "description" TEXT,
    "price" DECIMAL(10,2) NOT NULL,
    "cover_id" TEXT,
    "pdf_id" TEXT NOT NULL,
    "preview_pages" INTEGER[],
    "preview_pdf_id" TEXT,
    "published_at" TIMESTAMPTZ(6),
    "archived_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "books_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "book_purchases" (
    "id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "book_id" TEXT NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "payment_status" "payment_status" NOT NULL DEFAULT 'unlocked_no_gateway',
    "purchased_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "book_purchases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_conversations" (
    "id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ai_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_messages" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "role" "ai_role" NOT NULL,
    "content" TEXT NOT NULL,
    "tokens" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_usage" (
    "student_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "message_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ai_usage_pkey" PRIMARY KEY ("student_id","date")
);

-- CreateTable
CREATE TABLE "storage_objects" (
    "id" TEXT NOT NULL,
    "bucket" "bucket" NOT NULL,
    "key" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "original_name" TEXT,
    "uploaded_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "storage_objects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_by" TEXT,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "changes" JSONB,
    "ip" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_login_id_key" ON "users"("login_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_avatar_id_key" ON "users"("avatar_id");

-- CreateIndex
CREATE INDEX "users_role_status_idx" ON "users"("role", "status");

-- CreateIndex
CREATE INDEX "student_profiles_section_id_idx" ON "student_profiles"("section_id");

-- CreateIndex
CREATE UNIQUE INDEX "student_profiles_section_id_roll_key" ON "student_profiles"("section_id", "roll");

-- CreateIndex
CREATE UNIQUE INDEX "login_sessions_token_hash_key" ON "login_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "login_sessions_user_id_revoked_at_idx" ON "login_sessions"("user_id", "revoked_at");

-- CreateIndex
CREATE INDEX "login_sessions_expires_at_idx" ON "login_sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "tokens_token_hash_key" ON "tokens"("token_hash");

-- CreateIndex
CREATE INDEX "tokens_user_id_purpose_idx" ON "tokens"("user_id", "purpose");

-- CreateIndex
CREATE INDEX "login_histories_user_id_created_at_idx" ON "login_histories"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "login_histories_ip_created_at_idx" ON "login_histories"("ip", "created_at");

-- CreateIndex
CREATE INDEX "rate_limit_hits_window_start_idx" ON "rate_limit_hits"("window_start");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_name_key" ON "sessions"("name");

-- CreateIndex
CREATE UNIQUE INDEX "groups_session_id_type_key" ON "groups"("session_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "sections_mentor_teacher_id_key" ON "sections"("mentor_teacher_id");

-- CreateIndex
CREATE INDEX "sections_group_id_idx" ON "sections"("group_id");

-- CreateIndex
CREATE UNIQUE INDEX "courses_code_key" ON "courses"("code");

-- CreateIndex
CREATE INDEX "courses_group_type_class_level_idx" ON "courses"("group_type", "class_level");

-- CreateIndex
CREATE INDEX "chapters_course_id_order_idx" ON "chapters"("course_id", "order");

-- CreateIndex
CREATE UNIQUE INDEX "chapters_course_id_name_key" ON "chapters"("course_id", "name");

-- CreateIndex
CREATE INDEX "course_offerings_teacher_id_idx" ON "course_offerings"("teacher_id");

-- CreateIndex
CREATE INDEX "course_offerings_course_id_idx" ON "course_offerings"("course_id");

-- CreateIndex
CREATE UNIQUE INDEX "course_offerings_section_id_course_id_key" ON "course_offerings"("section_id", "course_id");

-- CreateIndex
CREATE INDEX "enrollments_student_id_status_idx" ON "enrollments"("student_id", "status");

-- CreateIndex
CREATE INDEX "enrollments_course_offering_id_status_idx" ON "enrollments"("course_offering_id", "status");

-- CreateIndex
CREATE INDEX "routine_slots_day_period_id_idx" ON "routine_slots"("day", "period_id");

-- CreateIndex
CREATE INDEX "routine_slots_room_id_idx" ON "routine_slots"("room_id");

-- CreateIndex
CREATE INDEX "routine_slot_offerings_course_offering_id_idx" ON "routine_slot_offerings"("course_offering_id");

-- CreateIndex
CREATE INDEX "routine_uploads_section_id_idx" ON "routine_uploads"("section_id");

-- CreateIndex
CREATE INDEX "holidays_start_date_end_date_idx" ON "holidays"("start_date", "end_date");

-- CreateIndex
CREATE INDEX "class_meetings_date_teacher_id_idx" ON "class_meetings"("date", "teacher_id");

-- CreateIndex
CREATE INDEX "class_meetings_date_room_id_period_id_idx" ON "class_meetings"("date", "room_id", "period_id");

-- CreateIndex
CREATE INDEX "class_meetings_date_status_idx" ON "class_meetings"("date", "status");

-- CreateIndex
CREATE INDEX "class_meetings_online_class_id_idx" ON "class_meetings"("online_class_id");

-- CreateIndex
CREATE INDEX "class_meetings_substitute_teacher_id_date_idx" ON "class_meetings"("substitute_teacher_id", "date");

-- CreateIndex
CREATE INDEX "class_meeting_offerings_course_offering_id_idx" ON "class_meeting_offerings"("course_offering_id");

-- CreateIndex
CREATE INDEX "attendance_records_student_id_course_offering_id_idx" ON "attendance_records"("student_id", "course_offering_id");

-- CreateIndex
CREATE INDEX "attendance_records_section_id_idx" ON "attendance_records"("section_id");

-- CreateIndex
CREATE INDEX "attendance_records_course_offering_id_idx" ON "attendance_records"("course_offering_id");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_records_class_meeting_id_student_id_key" ON "attendance_records"("class_meeting_id", "student_id");

-- CreateIndex
CREATE INDEX "attendance_edits_attendance_record_id_idx" ON "attendance_edits"("attendance_record_id");

-- CreateIndex
CREATE INDEX "posts_status_created_at_idx" ON "posts"("status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "posts_pinned_until_idx" ON "posts"("pinned_until");

-- CreateIndex
CREATE INDEX "posts_author_id_created_at_idx" ON "posts"("author_id", "created_at");

-- CreateIndex
CREATE INDEX "post_media_post_id_idx" ON "post_media"("post_id");

-- CreateIndex
CREATE INDEX "post_media_file_id_idx" ON "post_media"("file_id");

-- CreateIndex
CREATE INDEX "post_views_user_id_post_id_idx" ON "post_views"("user_id", "post_id");

-- CreateIndex
CREATE INDEX "comments_post_id_created_at_idx" ON "comments"("post_id", "created_at");

-- CreateIndex
CREATE INDEX "comments_parent_comment_id_idx" ON "comments"("parent_comment_id");

-- CreateIndex
CREATE INDEX "comments_author_id_created_at_idx" ON "comments"("author_id", "created_at");

-- CreateIndex
CREATE INDEX "comment_media_comment_id_idx" ON "comment_media"("comment_id");

-- CreateIndex
CREATE INDEX "comment_media_file_id_idx" ON "comment_media"("file_id");

-- CreateIndex
CREATE INDEX "reactions_post_id_idx" ON "reactions"("post_id");

-- CreateIndex
CREATE INDEX "reactions_comment_id_idx" ON "reactions"("comment_id");

-- CreateIndex
CREATE UNIQUE INDEX "reactions_user_id_post_id_key" ON "reactions"("user_id", "post_id");

-- CreateIndex
CREATE UNIQUE INDEX "reactions_user_id_comment_id_key" ON "reactions"("user_id", "comment_id");

-- CreateIndex
CREATE INDEX "reports_status_target_type_target_id_idx" ON "reports"("status", "target_type", "target_id");

-- CreateIndex
CREATE UNIQUE INDEX "reports_reporter_id_target_type_target_id_key" ON "reports"("reporter_id", "target_type", "target_id");

-- CreateIndex
CREATE INDEX "user_sanctions_user_id_type_ends_at_idx" ON "user_sanctions"("user_id", "type", "ends_at");

-- CreateIndex
CREATE UNIQUE INDEX "banned_words_word_key" ON "banned_words"("word");

-- CreateIndex
CREATE INDEX "blocks_blocked_id_idx" ON "blocks"("blocked_id");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_direct_key_key" ON "conversations"("direct_key");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_type_ref_id_key" ON "conversations"("type", "ref_id");

-- CreateIndex
CREATE INDEX "conversation_members_user_id_left_at_idx" ON "conversation_members"("user_id", "left_at");

-- CreateIndex
CREATE INDEX "messages_conversation_id_created_at_idx" ON "messages"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "messages_sender_id_idx" ON "messages"("sender_id");

-- CreateIndex
CREATE INDEX "notices_publish_at_idx" ON "notices"("publish_at");

-- CreateIndex
CREATE INDEX "notices_author_id_idx" ON "notices"("author_id");

-- CreateIndex
CREATE INDEX "notice_attachments_notice_id_idx" ON "notice_attachments"("notice_id");

-- CreateIndex
CREATE INDEX "notice_attachments_file_id_idx" ON "notice_attachments"("file_id");

-- CreateIndex
CREATE INDEX "notice_recipients_user_id_notice_id_idx" ON "notice_recipients"("user_id", "notice_id");

-- CreateIndex
CREATE INDEX "notice_reads_user_id_idx" ON "notice_reads"("user_id");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_created_at_idx" ON "notifications"("user_id", "read_at", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions"("endpoint");

-- CreateIndex
CREATE INDEX "push_subscriptions_user_id_idx" ON "push_subscriptions"("user_id");

-- CreateIndex
CREATE INDEX "online_classes_teacher_id_start_at_idx" ON "online_classes"("teacher_id", "start_at");

-- CreateIndex
CREATE INDEX "online_class_offerings_course_offering_id_idx" ON "online_class_offerings"("course_offering_id");

-- CreateIndex
CREATE INDEX "online_class_joins_online_class_id_student_id_idx" ON "online_class_joins"("online_class_id", "student_id");

-- CreateIndex
CREATE INDEX "online_class_joins_student_id_idx" ON "online_class_joins"("student_id");

-- CreateIndex
CREATE INDEX "recorded_classes_course_id_chapter_id_idx" ON "recorded_classes"("course_id", "chapter_id");

-- CreateIndex
CREATE INDEX "recorded_classes_course_offering_id_idx" ON "recorded_classes"("course_offering_id");

-- CreateIndex
CREATE INDEX "recording_progress_student_id_idx" ON "recording_progress"("student_id");

-- CreateIndex
CREATE INDEX "materials_course_id_chapter_id_idx" ON "materials"("course_id", "chapter_id");

-- CreateIndex
CREATE INDEX "materials_course_offering_id_idx" ON "materials"("course_offering_id");

-- CreateIndex
CREATE INDEX "materials_section_id_idx" ON "materials"("section_id");

-- CreateIndex
CREATE INDEX "materials_group_id_idx" ON "materials"("group_id");

-- CreateIndex
CREATE INDEX "material_files_material_id_idx" ON "material_files"("material_id");

-- CreateIndex
CREATE INDEX "material_files_file_id_idx" ON "material_files"("file_id");

-- CreateIndex
CREATE INDEX "material_chunks_course_id_idx" ON "material_chunks"("course_id");

-- CreateIndex
CREATE INDEX "material_chunks_material_id_chunk_no_idx" ON "material_chunks"("material_id", "chunk_no");

-- CreateIndex
CREATE INDEX "material_views_material_id_action_idx" ON "material_views"("material_id", "action");

-- CreateIndex
CREATE INDEX "material_views_user_id_idx" ON "material_views"("user_id");

-- CreateIndex
CREATE INDEX "previous_questions_course_id_year_exam_type_idx" ON "previous_questions"("course_id", "year", "exam_type");

-- CreateIndex
CREATE INDEX "questions_teacher_id_course_id_idx" ON "questions"("teacher_id", "course_id");

-- CreateIndex
CREATE INDEX "questions_course_id_chapter_id_idx" ON "questions"("course_id", "chapter_id");

-- CreateIndex
CREATE INDEX "exams_course_offering_id_start_at_idx" ON "exams"("course_offering_id", "start_at");

-- CreateIndex
CREATE INDEX "exams_status_start_at_idx" ON "exams"("status", "start_at");

-- CreateIndex
CREATE INDEX "exam_questions_exam_id_order_idx" ON "exam_questions"("exam_id", "order");

-- CreateIndex
CREATE INDEX "exam_attempts_exam_id_status_idx" ON "exam_attempts"("exam_id", "status");

-- CreateIndex
CREATE INDEX "exam_attempts_student_id_idx" ON "exam_attempts"("student_id");

-- CreateIndex
CREATE INDEX "exam_attempts_status_deadline_at_idx" ON "exam_attempts"("status", "deadline_at");

-- CreateIndex
CREATE UNIQUE INDEX "exam_attempts_exam_id_student_id_attempt_no_key" ON "exam_attempts"("exam_id", "student_id", "attempt_no");

-- CreateIndex
CREATE INDEX "attempt_extensions_attempt_id_idx" ON "attempt_extensions"("attempt_id");

-- CreateIndex
CREATE INDEX "answers_exam_question_id_idx" ON "answers"("exam_question_id");

-- CreateIndex
CREATE INDEX "exam_change_logs_exam_id_idx" ON "exam_change_logs"("exam_id");

-- CreateIndex
CREATE INDEX "books_course_id_idx" ON "books"("course_id");

-- CreateIndex
CREATE INDEX "books_published_at_idx" ON "books"("published_at");

-- CreateIndex
CREATE INDEX "book_purchases_book_id_idx" ON "book_purchases"("book_id");

-- CreateIndex
CREATE UNIQUE INDEX "book_purchases_student_id_book_id_key" ON "book_purchases"("student_id", "book_id");

-- CreateIndex
CREATE INDEX "ai_conversations_student_id_updated_at_idx" ON "ai_conversations"("student_id", "updated_at");

-- CreateIndex
CREATE INDEX "ai_messages_conversation_id_created_at_idx" ON "ai_messages"("conversation_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "storage_objects_key_key" ON "storage_objects"("key");

-- CreateIndex
CREATE INDEX "storage_objects_deleted_at_idx" ON "storage_objects"("deleted_at");

-- CreateIndex
CREATE INDEX "audit_logs_target_type_target_id_idx" ON "audit_logs"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_created_at_idx" ON "audit_logs"("actor_id", "created_at");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_avatar_id_fkey" FOREIGN KEY ("avatar_id") REFERENCES "storage_objects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_profiles" ADD CONSTRAINT "student_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_profiles" ADD CONSTRAINT "student_profiles_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "sections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_profiles" ADD CONSTRAINT "teacher_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "login_sessions" ADD CONSTRAINT "login_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tokens" ADD CONSTRAINT "tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "login_histories" ADD CONSTRAINT "login_histories_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "groups" ADD CONSTRAINT "groups_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sections" ADD CONSTRAINT "sections_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sections" ADD CONSTRAINT "sections_mentor_teacher_id_fkey" FOREIGN KEY ("mentor_teacher_id") REFERENCES "teacher_profiles"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_offerings" ADD CONSTRAINT "course_offerings_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "sections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_offerings" ADD CONSTRAINT "course_offerings_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_offerings" ADD CONSTRAINT "course_offerings_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "teacher_profiles"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_course_offering_id_fkey" FOREIGN KEY ("course_offering_id") REFERENCES "course_offerings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student_profiles"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routine_slots" ADD CONSTRAINT "routine_slots_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routine_slots" ADD CONSTRAINT "routine_slots_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routine_slot_offerings" ADD CONSTRAINT "routine_slot_offerings_routine_slot_id_fkey" FOREIGN KEY ("routine_slot_id") REFERENCES "routine_slots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routine_slot_offerings" ADD CONSTRAINT "routine_slot_offerings_course_offering_id_fkey" FOREIGN KEY ("course_offering_id") REFERENCES "course_offerings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routine_uploads" ADD CONSTRAINT "routine_uploads_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "sections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routine_uploads" ADD CONSTRAINT "routine_uploads_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "storage_objects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "special_days" ADD CONSTRAINT "special_days_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_meetings" ADD CONSTRAINT "class_meetings_routine_slot_id_fkey" FOREIGN KEY ("routine_slot_id") REFERENCES "routine_slots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_meetings" ADD CONSTRAINT "class_meetings_online_class_id_fkey" FOREIGN KEY ("online_class_id") REFERENCES "online_classes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_meetings" ADD CONSTRAINT "class_meetings_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_meetings" ADD CONSTRAINT "class_meetings_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_meetings" ADD CONSTRAINT "class_meetings_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "teacher_profiles"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_meetings" ADD CONSTRAINT "class_meetings_substitute_teacher_id_fkey" FOREIGN KEY ("substitute_teacher_id") REFERENCES "teacher_profiles"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_meeting_offerings" ADD CONSTRAINT "class_meeting_offerings_class_meeting_id_fkey" FOREIGN KEY ("class_meeting_id") REFERENCES "class_meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_meeting_offerings" ADD CONSTRAINT "class_meeting_offerings_course_offering_id_fkey" FOREIGN KEY ("course_offering_id") REFERENCES "course_offerings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_class_meeting_id_fkey" FOREIGN KEY ("class_meeting_id") REFERENCES "class_meetings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student_profiles"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "sections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_course_offering_id_fkey" FOREIGN KEY ("course_offering_id") REFERENCES "course_offerings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_edits" ADD CONSTRAINT "attendance_edits_attendance_record_id_fkey" FOREIGN KEY ("attendance_record_id") REFERENCES "attendance_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_pdf_id_fkey" FOREIGN KEY ("pdf_id") REFERENCES "storage_objects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_pin_section_id_fkey" FOREIGN KEY ("pin_section_id") REFERENCES "sections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_media" ADD CONSTRAINT "post_media_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_media" ADD CONSTRAINT "post_media_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "storage_objects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_views" ADD CONSTRAINT "post_views_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_views" ADD CONSTRAINT "post_views_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_parent_comment_id_fkey" FOREIGN KEY ("parent_comment_id") REFERENCES "comments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_media" ADD CONSTRAINT "comment_media_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_media" ADD CONSTRAINT "comment_media_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "storage_objects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "comments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_sanctions" ADD CONSTRAINT "user_sanctions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_sanctions" ADD CONSTRAINT "user_sanctions_related_report_id_fkey" FOREIGN KEY ("related_report_id") REFERENCES "reports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_blocker_id_fkey" FOREIGN KEY ("blocker_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_blocked_id_fkey" FOREIGN KEY ("blocked_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_members" ADD CONSTRAINT "conversation_members_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_members" ADD CONSTRAINT "conversation_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_members" ADD CONSTRAINT "conversation_members_last_read_message_id_fkey" FOREIGN KEY ("last_read_message_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_attachment_id_fkey" FOREIGN KEY ("attachment_id") REFERENCES "storage_objects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notices" ADD CONSTRAINT "notices_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notice_attachments" ADD CONSTRAINT "notice_attachments_notice_id_fkey" FOREIGN KEY ("notice_id") REFERENCES "notices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notice_attachments" ADD CONSTRAINT "notice_attachments_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "storage_objects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notice_recipients" ADD CONSTRAINT "notice_recipients_notice_id_fkey" FOREIGN KEY ("notice_id") REFERENCES "notices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notice_recipients" ADD CONSTRAINT "notice_recipients_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notice_reads" ADD CONSTRAINT "notice_reads_notice_id_fkey" FOREIGN KEY ("notice_id") REFERENCES "notices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notice_reads" ADD CONSTRAINT "notice_reads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_prefs" ADD CONSTRAINT "notification_prefs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "online_classes" ADD CONSTRAINT "online_classes_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "teacher_profiles"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "online_class_offerings" ADD CONSTRAINT "online_class_offerings_online_class_id_fkey" FOREIGN KEY ("online_class_id") REFERENCES "online_classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "online_class_offerings" ADD CONSTRAINT "online_class_offerings_course_offering_id_fkey" FOREIGN KEY ("course_offering_id") REFERENCES "course_offerings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "online_class_joins" ADD CONSTRAINT "online_class_joins_online_class_id_fkey" FOREIGN KEY ("online_class_id") REFERENCES "online_classes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "online_class_joins" ADD CONSTRAINT "online_class_joins_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student_profiles"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recorded_classes" ADD CONSTRAINT "recorded_classes_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recorded_classes" ADD CONSTRAINT "recorded_classes_course_offering_id_fkey" FOREIGN KEY ("course_offering_id") REFERENCES "course_offerings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recorded_classes" ADD CONSTRAINT "recorded_classes_chapter_id_fkey" FOREIGN KEY ("chapter_id") REFERENCES "chapters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recording_progress" ADD CONSTRAINT "recording_progress_recorded_class_id_fkey" FOREIGN KEY ("recorded_class_id") REFERENCES "recorded_classes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recording_progress" ADD CONSTRAINT "recording_progress_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student_profiles"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "materials" ADD CONSTRAINT "materials_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "materials" ADD CONSTRAINT "materials_course_offering_id_fkey" FOREIGN KEY ("course_offering_id") REFERENCES "course_offerings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "materials" ADD CONSTRAINT "materials_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "sections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "materials" ADD CONSTRAINT "materials_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "materials" ADD CONSTRAINT "materials_chapter_id_fkey" FOREIGN KEY ("chapter_id") REFERENCES "chapters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_files" ADD CONSTRAINT "material_files_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_files" ADD CONSTRAINT "material_files_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "storage_objects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_chunks" ADD CONSTRAINT "material_chunks_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_chunks" ADD CONSTRAINT "material_chunks_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_views" ADD CONSTRAINT "material_views_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_views" ADD CONSTRAINT "material_views_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "previous_questions" ADD CONSTRAINT "previous_questions_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "previous_questions" ADD CONSTRAINT "previous_questions_solution_id_fkey" FOREIGN KEY ("solution_id") REFERENCES "storage_objects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "teacher_profiles"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_chapter_id_fkey" FOREIGN KEY ("chapter_id") REFERENCES "chapters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exams" ADD CONSTRAINT "exams_course_offering_id_fkey" FOREIGN KEY ("course_offering_id") REFERENCES "course_offerings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_questions" ADD CONSTRAINT "exam_questions_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "exams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_questions" ADD CONSTRAINT "exam_questions_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_questions" ADD CONSTRAINT "exam_questions_chapter_id_fkey" FOREIGN KEY ("chapter_id") REFERENCES "chapters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_attempts" ADD CONSTRAINT "exam_attempts_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "exams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_attempts" ADD CONSTRAINT "exam_attempts_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student_profiles"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_attempts" ADD CONSTRAINT "exam_attempts_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "sections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attempt_extensions" ADD CONSTRAINT "attempt_extensions_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "exam_attempts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "answers" ADD CONSTRAINT "answers_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "exam_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "answers" ADD CONSTRAINT "answers_exam_question_id_fkey" FOREIGN KEY ("exam_question_id") REFERENCES "exam_questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_change_logs" ADD CONSTRAINT "exam_change_logs_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "exams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_change_logs" ADD CONSTRAINT "exam_change_logs_exam_question_id_fkey" FOREIGN KEY ("exam_question_id") REFERENCES "exam_questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "books" ADD CONSTRAINT "books_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "books" ADD CONSTRAINT "books_cover_id_fkey" FOREIGN KEY ("cover_id") REFERENCES "storage_objects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "books" ADD CONSTRAINT "books_pdf_id_fkey" FOREIGN KEY ("pdf_id") REFERENCES "storage_objects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "books" ADD CONSTRAINT "books_preview_pdf_id_fkey" FOREIGN KEY ("preview_pdf_id") REFERENCES "storage_objects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "book_purchases" ADD CONSTRAINT "book_purchases_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student_profiles"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "book_purchases" ADD CONSTRAINT "book_purchases_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "books"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student_profiles"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "ai_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student_profiles"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ═════════════════════════════════════════════════════════════════════
-- Hand-written SQL (docs/spec/01-database.md §3). Prisma cannot express these.
-- ═════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- class level
ALTER TABLE sections ADD CONSTRAINT sections_class_chk CHECK (class_level IN (11,12));
CREATE UNIQUE INDEX sections_name_uq ON sections (group_id, class_level, name) WHERE deleted_at IS NULL;

-- one active enrollment per student + offering
CREATE UNIQUE INDEX enrollments_active_uq ON enrollments (course_offering_id, student_id) WHERE status = 'active';

-- one in-progress attempt per student + exam
CREATE UNIQUE INDEX attempts_inprogress_uq ON exam_attempts (exam_id, student_id) WHERE status = 'in_progress';

-- reactions target exactly one thing
ALTER TABLE reactions ADD CONSTRAINT reactions_target_chk CHECK (num_nonnulls(post_id, comment_id) = 1);

-- exam settings
ALTER TABLE exams ADD CONSTRAINT exams_window_chk CHECK (end_at > start_at);
ALTER TABLE exams ADD CONSTRAINT exams_duration_chk CHECK (duration_min IN (15,30,45,60,90,120));
ALTER TABLE exams ADD CONSTRAINT exams_pass_chk CHECK (pass_marks <= total_marks);

-- schedule
CREATE UNIQUE INDEX class_meetings_slot_day_uq ON class_meetings (routine_slot_id, COALESCE(original_date, date)) WHERE routine_slot_id IS NOT NULL;
ALTER TABLE periods  ADD CONSTRAINT periods_time_chk  CHECK (end_time > start_time);
ALTER TABLE holidays ADD CONSTRAINT holidays_range_chk CHECK (end_date >= start_date);
CREATE UNIQUE INDEX special_days_uq ON special_days (date, session_id) NULLS NOT DISTINCT;

-- Student 360 search (03 §7)
CREATE INDEX student_profiles_name_trgm_idx ON student_profiles USING GIN (name gin_trgm_ops);
CREATE INDEX users_login_id_trgm_idx ON users USING GIN (login_id gin_trgm_ops);

-- AI grounding full-text search
ALTER TABLE material_chunks ADD COLUMN tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED;
CREATE INDEX material_chunks_tsv_idx ON material_chunks USING GIN (tsv);

-- Lock the Supabase REST API: RLS on, no policies, on EVERY table in public (incl. _prisma_migrations).
-- Every future migration must end with this same block (see prisma/README.md).
DO $$ DECLARE t text; BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP; END $$;
