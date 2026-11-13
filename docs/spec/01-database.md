# 01 · Database (Prisma on Supabase PostgreSQL)

Source: PRD §6 and every rule that implies a constraint. `docs/tech.stack.md` §4.

## 1. Rules

- Every change is a migration in `/prisma/migrations`. Constraints Prisma cannot express (CHECK, partial unique indexes, RLS, `tsvector`) go in hand-edited SQL in the same migration.
- `DATABASE_URL` = session pooler (5432), `DIRECT_URL` = direct (migrations only).
- Table names: Prisma model names mapped to `snake_case` plural with `@@map`; columns `snake_case` with `@map`. (Omitted below for readability; add them in the real schema.)
- Marks are `Decimal(6,2)`; percentages are computed, not stored.
- No files or large blobs in tables (500 MB free plan).

## 2. Schema

```prisma
generator client { provider = "prisma-client-js" }
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}

// ───────── Enums ─────────
enum Role             { admin teacher student }
enum UserStatus       { active inactive passed_out deleted }
enum SessionStatus    { active closed }
enum GroupType        { science commerce arts }
enum CourseGroup      { science commerce arts common }
enum CourseClass      { c11 c12 both }
enum Paper            { first second none }
enum EnrollmentStatus { active ended }
enum Weekday          { sun mon tue wed thu fri sat }
enum MeetingStatus    { scheduled held cancelled removed }
enum AttendanceStatus { present absent late excused }
enum PostTag          { general problem study event }
enum ContentStatus    { published held removed }   // held = banned-word review; removed = soft-deleted by Admin/author
enum PinAudience      { all section }
enum ReactionType     { like love haha wow sad angry }
enum ReportTarget     { post comment message user }
enum ReportStatus     { open dismissed actioned }
enum ConversationType { direct group section }
enum NoticeScope      { central class }
enum NoticePriority   { normal important urgent }
enum MeetPlatform     { meet jitsi other }
enum OnlineClassStatus{ scheduled live ended cancelled }
enum VideoSource      { youtube drive }
enum RecordingVisibility { section college }
enum MaterialScope    { offering section group college }
enum QuestionType     { single multiple }
enum ExamKind         { exam quiz }
enum ExamStatus       { draft published closed }
enum ResultMode       { instant manual }
enum AttemptStatus    { in_progress submitted auto_submitted }
enum PrevExamType     { hsc_board test pre_test half_yearly model_test }
enum PaymentStatus    { unlocked_no_gateway }
enum AIRole           { user assistant }
enum TokenPurpose     { password_reset email_verify email_change }
enum SanctionType     { warn mute }
enum ViewAction       { view download }
enum Bucket           { public private }

// ───────── Users & auth ─────────
model User {
  id               String     @id @default(cuid())
  loginId          String?    @unique          // null after anonymise (PRD §4.4)
  email            String?    @unique          // stored lower-case
  emailVerifiedAt  DateTime?
  mobile           String?
  passwordHash     String?
  role             Role
  status           UserStatus @default(active)
  firstLogin       Boolean    @default(true)
  avatarId         String?    @unique
  avatar           StorageObject? @relation("UserAvatar", fields: [avatarId], references: [id])
  totpSecretEnc    String?    // Admin only, AES-256-GCM
  totpEnabledAt    DateTime?
  backupCodeHashes String[]   // Admin only, argon2 hashes, removed when used
  mustChangePassword Boolean  @default(true)
  lastLoginAt      DateTime?
  createdAt        DateTime   @default(now())
  updatedAt        DateTime   @updatedAt
  anonymisedAt     DateTime?
  student          StudentProfile?
  teacher          TeacherProfile?
  @@index([role, status])
}

model StudentProfile {
  userId          String  @id
  user            User    @relation(fields: [userId], references: [id])
  name            String
  nameLocked      Boolean @default(false)
  sectionId       String           // current section; session/group/class come from it
  section         Section @relation(fields: [sectionId], references: [id])
  roll            String
  bio             String?
  dob             DateTime? @db.Date
  address         String?
  guardianName    String?
  guardianContact String?
  passedOutAt     DateTime?
  @@unique([sectionId, roll])
  @@index([sectionId])
}

model TeacherProfile {
  userId      String   @id
  user        User     @relation(fields: [userId], references: [id])
  name        String
  designation String?
  subjects    String[]     // free tags used to filter the teacher dropdown (PRD §3.3)
  bio         String?
}

model LoginSession {
  id         String    @id @default(cuid())
  userId     String
  tokenHash  String    @unique     // sha256 of the cookie token
  createdAt  DateTime  @default(now())
  expiresAt  DateTime
  lastSeenAt DateTime  @default(now())
  revokedAt  DateTime?
  ip         String?
  userAgent  String?
  stepUpPending Boolean @default(false) // Admin: password OK, TOTP not yet entered
  @@index([userId, revokedAt])
}

model Token {
  id        String       @id @default(cuid())
  userId    String
  tokenHash String       @unique
  purpose   TokenPurpose
  newEmail  String?      // email_change only
  expiresAt DateTime
  usedAt    DateTime?
  createdAt DateTime     @default(now())
  @@index([userId, purpose])
}

model LoginHistory {
  id        String   @id @default(cuid())
  userId    String?          // null when the identifier matched no user
  identifierHash String?     // sha256 of the typed ID/email, for rate limiting only
  success   Boolean
  ip        String?
  userAgent String?
  createdAt DateTime @default(now())
  @@index([userId, createdAt])
  @@index([ip, createdAt])
}

model RateLimitHit {
  key       String          // e.g. "login:ip:1.2.3.4"
  windowStart DateTime
  count     Int      @default(1)
  @@id([key, windowStart])
}

// ───────── Academic structure ─────────
model Session {
  id        String        @id @default(cuid())
  name      String        @unique   // "2024–25"
  status    SessionStatus @default(active)
  closedAt  DateTime?
  createdAt DateTime      @default(now())
  groups    Group[]
}

model Group {
  id        String    @id @default(cuid())
  sessionId String
  session   Session   @relation(fields: [sessionId], references: [id])
  type      GroupType
  sections  Section[]
  @@unique([sessionId, type])
}

model Section {
  id              String   @id @default(cuid())
  groupId         String
  group           Group    @relation(fields: [groupId], references: [id])
  classLevel      Int      @db.SmallInt   // CHECK (class_level IN (11,12))
  name            String                  // "A"
  mentorTeacherId String?  @unique        // one section per mentor and one mentor per section
  deletedAt       DateTime?
  createdAt       DateTime @default(now())
  students        StudentProfile[]
  offerings       CourseOffering[]
  // partial unique: (group_id, class_level, name) WHERE deleted_at IS NULL
}

model Course {
  id         String      @id @default(cuid())
  code       String      @unique
  name       String
  groupType  CourseGroup
  classLevel CourseClass
  paper      Paper       @default(none)
  isOptional Boolean     @default(false)
  archivedAt DateTime?
  chapters   Chapter[]
}

model Chapter {
  id       String @id @default(cuid())
  courseId String
  course   Course @relation(fields: [courseId], references: [id])
  name     String
  order    Int
  createdById String
  @@unique([courseId, name])
  @@index([courseId, order])
}

model CourseOffering {
  id         String   @id @default(cuid())
  sectionId  String
  section    Section  @relation(fields: [sectionId], references: [id])
  courseId   String
  course     Course   @relation(fields: [courseId], references: [id])
  teacherId  String
  createdAt  DateTime @default(now())
  endedAt    DateTime?            // offering removed from the section; history kept
  @@unique([sectionId, courseId])
  @@index([teacherId])
}

model Enrollment {
  id               String           @id @default(cuid())
  courseOfferingId String
  studentId        String
  status           EnrollmentStatus @default(active)
  enrolledAt       DateTime         @default(now())
  endedAt          DateTime?
  @@index([studentId, status])
  @@index([courseOfferingId, status])
  // partial unique: (course_offering_id, student_id) WHERE status = 'active'
}

// ───────── Schedule ─────────
model Period {
  id        String   @id @default(cuid())
  name      String
  startTime DateTime @db.Time(0)
  endTime   DateTime @db.Time(0)      // CHECK (end_time > start_time)
  deletedAt DateTime?
}

model Room {
  id        String  @id @default(cuid())
  name      String
  capacity  Int?
  building  String?
  deletedAt DateTime?
}

model RoutineSlot {
  id        String   @id @default(cuid())
  day       Weekday
  periodId  String
  roomId    String?
  createdAt DateTime @default(now())
  deletedAt DateTime?
  offerings RoutineSlotOffering[]
  @@index([day, periodId])
}

model RoutineSlotOffering {
  routineSlotId    String
  courseOfferingId String
  @@id([routineSlotId, courseOfferingId])
  @@index([courseOfferingId])
}

model RoutineUpload {           // "upload routine as image/PDF" (PRD §5.17)
  id        String   @id @default(cuid())
  sectionId String
  fileId    String
  createdAt DateTime @default(now())
  deletedAt DateTime?
}

model Holiday {
  id        String   @id @default(cuid())
  startDate DateTime @db.Date
  endDate   DateTime @db.Date        // CHECK (end_date >= start_date)
  title     String
  createdBy String
  createdAt DateTime @default(now())
}

model SpecialDay {
  id        String   @id @default(cuid())
  date      DateTime @db.Date
  title     String
  sessionId String?                  // null = whole college
  periodIds String[]                 // periods that run that day (PRD "periods_json")
  createdBy String
  // unique (date, session_id) with NULLS NOT DISTINCT
}

model ClassMeeting {
  id                  String        @id @default(cuid())
  routineSlotId       String?                    // null = extra class
  onlineClassId       String?
  date                DateTime      @db.Date
  originalDate        DateTime?     @db.Date     // set when the Admin moves a routine meeting to another date
  manuallyEdited      Boolean       @default(false) // moved / room change / substitute: generator leaves it alone
  periodId            String?
  roomId              String?
  startTime           DateTime      @db.Time(0)  // copied at creation
  endTime             DateTime      @db.Time(0)
  teacherId           String
  substituteTeacherId String?
  status              MeetingStatus @default(scheduled)
  attendanceTakenAt   DateTime?                  // set on first submit; "Not taken" when null
  createdAt           DateTime      @default(now())
  offerings           ClassMeetingOffering[]
  // UNIQUE (routine_slot_id, COALESCE(original_date, date)) — expression index in raw SQL (PRD: one slot never creates two meetings a day)
  @@index([date, teacherId])
  @@index([date, roomId, periodId])
  @@index([onlineClassId])
}

model ClassMeetingOffering {
  classMeetingId   String
  courseOfferingId String
  @@id([classMeetingId, courseOfferingId])
  @@index([courseOfferingId])
}

model AttendanceRecord {
  id             String           @id @default(cuid())
  classMeetingId String
  studentId      String
  sectionId      String                       // section at the time of the class
  courseOfferingId String                     // which offering of a combined class
  status         AttendanceStatus
  markedBy       String
  markedAt       DateTime         @default(now())
  @@unique([classMeetingId, studentId])
  @@index([studentId, courseOfferingId])
  @@index([sectionId])
}

model AttendanceEdit {
  id                 String           @id @default(cuid())
  attendanceRecordId String
  oldStatus          AttendanceStatus
  newStatus          AttendanceStatus
  editedBy           String
  editedAt           DateTime         @default(now())
  @@index([attendanceRecordId])
}

// ───────── Community ─────────
model Post {
  id           String        @id @default(cuid())
  authorId     String
  text         String
  tag          PostTag       @default(general)
  linkUrl      String?
  pdfId        String?
  pinnedUntil  DateTime?                       // null = not pinned / unpinned
  pinAudience  PinAudience?
  pinSectionId String?                         // set when pinAudience = section
  status       ContentStatus @default(published)
  editedAt     DateTime?
  removedAt    DateTime?
  removedBy    String?
  createdAt    DateTime      @default(now())
  media        PostMedia[]
  @@index([status, createdAt(sort: Desc)])
  @@index([pinnedUntil])
  @@index([authorId, createdAt])
}

model PostMedia {
  id     String @id @default(cuid())
  postId String
  fileId String
  order  Int
  @@index([postId])
}

model PostView {
  postId String
  userId String
  seenAt DateTime @default(now())
  @@id([postId, userId])
}

model Comment {
  id              String        @id @default(cuid())
  postId          String
  parentCommentId String?                     // one level only (enforced in service)
  authorId        String
  text            String
  linkUrl         String?
  status          ContentStatus @default(published)
  editedAt        DateTime?
  removedAt       DateTime?
  createdAt       DateTime      @default(now())
  @@index([postId, createdAt])
}

model CommentMedia {
  id        String @id @default(cuid())
  commentId String
  fileId    String
  order     Int
}

model Reaction {
  id        String       @id @default(cuid())
  userId    String
  postId    String?
  commentId String?
  type      ReactionType
  createdAt DateTime     @default(now())
  @@unique([userId, postId])
  @@unique([userId, commentId])
  // CHECK (num_nonnulls(post_id, comment_id) = 1)
}

model Report {
  id         String       @id @default(cuid())
  reporterId String
  targetType ReportTarget
  targetId   String
  reason     String
  status     ReportStatus @default(open)
  resolvedBy String?
  resolvedAt DateTime?
  createdAt  DateTime     @default(now())
  @@unique([reporterId, targetType, targetId])
  @@index([status, targetType, targetId])
}

model UserSanction {
  id              String       @id @default(cuid())
  userId          String
  type            SanctionType
  reason          String
  relatedReportId String?
  startsAt        DateTime     @default(now())
  endsAt          DateTime?                    // null for warn
  liftedAt        DateTime?
  createdBy       String
  @@index([userId, type, endsAt])
}

model BannedWord {
  id        String   @id @default(cuid())
  word      String   @unique     // lower-case, NFC normalised
  createdBy String
  createdAt DateTime @default(now())
}

model Block {
  blockerId String
  blockedId String
  createdAt DateTime @default(now())
  @@id([blockerId, blockedId])
}

// ───────── Chat ─────────
model Conversation {
  id        String           @id @default(cuid())
  type      ConversationType
  refId     String?                     // group id or section id
  directKey String?          @unique    // "<smallerUserId>:<largerUserId>"
  createdAt DateTime         @default(now())
  lastMessageAt DateTime?
  @@unique([type, refId])
}

model ConversationMember {
  conversationId    String
  userId            String
  joinedAt          DateTime @default(now())
  leftAt            DateTime?
  lastReadMessageId String?
  @@id([conversationId, userId])
  @@index([userId, leftAt])
}

model Message {
  id             String    @id @default(cuid())
  conversationId String
  senderId       String
  text           String?
  attachmentId   String?
  createdAt      DateTime  @default(now())
  deletedAt      DateTime?
  @@index([conversationId, createdAt])
}

// ───────── Notices & notifications ─────────
model Notice {
  id           String         @id @default(cuid())
  authorId     String
  scope        NoticeScope
  audience     Json           // see 07 §3.1
  title        String
  bodyHtml     String
  priority     NoticePriority @default(normal)
  showOnLanding Boolean       @default(false)  // central only
  publishAt    DateTime       @default(now())
  publishedAt  DateTime?                       // set by job when delivered
  expiresAt    DateTime?
  deletedAt    DateTime?
  createdAt    DateTime       @default(now())
  attachments  NoticeAttachment[]
  @@index([publishAt])
}

model NoticeAttachment { id String @id @default(cuid()); noticeId String; fileId String }

model NoticeRecipient {          // resolved audience at publish time (fast "my notices" + unread)
  noticeId String
  userId   String
  @@id([noticeId, userId])
  @@index([userId])
}

model NoticeRead {
  noticeId String
  userId   String
  readAt   DateTime @default(now())
  @@id([noticeId, userId])
}

model Notification {
  id        String    @id @default(cuid())
  userId    String
  type      String                 // see 07 §5 catalogue
  refType   String?
  refId     String?
  text      String
  readAt    DateTime?
  createdAt DateTime  @default(now())
  @@index([userId, readAt, createdAt])
}

model NotificationPref {
  userId String
  type   String
  email  Boolean @default(true)
  push   Boolean @default(true)
  @@id([userId, type])
}

model PushSubscription {
  id        String   @id @default(cuid())
  userId    String
  endpoint  String   @unique
  p256dh    String
  auth      String
  createdAt DateTime @default(now())
}

model EmailQuota {
  date  DateTime @id @db.Date   // Asia/Dhaka date
  sent  Int      @default(0)
}

// ───────── Learning content ─────────
model OnlineClass {
  id          String            @id @default(cuid())
  teacherId   String
  title       String
  topic       String?
  description String?
  startAt     DateTime
  durationMin Int
  platform    MeetPlatform
  joinUrl     String
  status      OnlineClassStatus @default(scheduled)
  createdAt   DateTime          @default(now())
  offerings   OnlineClassOffering[]
}

model OnlineClassOffering {
  onlineClassId    String
  courseOfferingId String
  @@id([onlineClassId, courseOfferingId])
}

model OnlineClassJoin {
  id            String   @id @default(cuid())
  onlineClassId String
  studentId     String
  clickedJoinAt DateTime @default(now())
  @@index([onlineClassId, studentId])
}

model RecordedClass {
  id               String              @id @default(cuid())
  courseId         String
  courseOfferingId String?                       // null = college-wide (Admin)
  chapterId        String?
  title            String
  description      String?
  videoSource      VideoSource
  url              String
  videoId          String?                       // parsed YouTube id / Drive file id
  visibility       RecordingVisibility @default(section)
  createdBy        String
  createdAt        DateTime            @default(now())
  deletedAt        DateTime?
  @@index([courseId, chapterId])
}

model RecordingProgress {
  recordedClassId String
  studentId       String
  firstOpenedAt   DateTime @default(now())
  lastOpenedAt    DateTime @default(now())
  @@id([recordedClassId, studentId])
}

model Material {
  id               String        @id @default(cuid())
  scope            MaterialScope
  courseId         String?
  courseOfferingId String?                    // scope = offering
  sectionId        String?                    // scope = section (mentor)
  groupId          String?                    // scope = group (Admin)
  chapterId        String?
  title            String
  description      String?
  linkUrl          String?
  createdBy        String
  createdAt        DateTime      @default(now())
  deletedAt        DateTime?
  files            MaterialFile[]
}

model MaterialFile { id String @id @default(cuid()); materialId String; fileId String; order Int }

model MaterialChunk {             // AI grounding (09 §2.6)
  id         String @id @default(cuid())
  materialId String
  courseId   String?
  chunkNo    Int
  content    String
  // tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED + GIN index (raw SQL)
  @@index([courseId])
}

model MaterialView {
  id         String     @id @default(cuid())
  materialId String
  userId     String
  action     ViewAction
  createdAt  DateTime   @default(now())
  @@index([materialId, action])
}

model PreviousQuestion {
  id         String       @id @default(cuid())
  courseId   String
  year       Int
  examType   PrevExamType
  board      String?
  fileIds    String[]
  solutionId String?
  createdBy  String
  createdAt  DateTime     @default(now())
  deletedAt  DateTime?
  @@index([courseId, year, examType])
}

// ───────── Exams ─────────
model Question {
  id          String       @id @default(cuid())
  teacherId   String
  courseId    String
  chapterId   String?
  type        QuestionType
  text        String
  options     Json         // [{ id: "o1", text: "..." }] stable ids
  correct     Json         // ["o2"] or ["o1","o3"]
  marks       Decimal      @default(1) @db.Decimal(6,2)
  createdAt   DateTime     @default(now())
  archivedAt  DateTime?
  @@index([teacherId, courseId])
}

model Exam {
  id                 String     @id @default(cuid())
  courseOfferingId   String
  createdBy          String
  kind               ExamKind
  title              String
  instructions       String?
  startAt            DateTime
  endAt              DateTime                   // CHECK (end_at > start_at)
  durationMin        Int                        // CHECK IN (15,30,45,60,90,120)
  totalMarks         Decimal    @db.Decimal(6,2)
  passMarks          Decimal    @db.Decimal(6,2)
  maxAttempts        Int        @default(1)     // exam: always 1
  shuffleQuestions   Boolean    @default(false)
  shuffleOptions     Boolean    @default(false)
  showAnswersAfterEnd Boolean   @default(true)
  resultMode         ResultMode @default(instant)
  status             ExamStatus @default(draft)
  publishedAt        DateTime?
  resultsPublishedAt DateTime?
  revealedAt         DateTime?                  // window + all extra time ended (05 §4.6)
  createdAt          DateTime   @default(now())
  updatedAt          DateTime   @updatedAt
  @@index([courseOfferingId, startAt])
}

model ExamQuestion {
  id          String       @id @default(cuid())
  examId      String
  questionId  String?
  order       Int
  type        QuestionType
  text        String
  options     Json
  correct     Json
  marks       Decimal      @db.Decimal(6,2)
  chapterId   String?
  isCancelled Boolean      @default(false)
  @@index([examId, order])
}

model ExamAttempt {
  id            String        @id @default(cuid())
  examId        String
  studentId     String
  attemptNo     Int
  sectionId     String
  startedAt     DateTime      @default(now())
  deadlineAt    DateTime
  extraMinutes  Int           @default(0)
  questionOrder Json          // [{ q: examQuestionId, o: [optionIds...] }]
  submittedAt   DateTime?
  score         Decimal?      @db.Decimal(6,2)
  status        AttemptStatus @default(in_progress)
  integrityLog  Json          @default("[]")   // [{ t, type: "blur"|"fullscreen_exit"|"resume" }]
  @@unique([examId, studentId, attemptNo])
  @@index([examId, status])
  // partial unique: (exam_id, student_id) WHERE status = 'in_progress'
}

model AttemptExtension {
  id         String   @id @default(cuid())
  attemptId  String
  minutes    Int
  reopened   Boolean  @default(false)
  givenBy    String
  createdAt  DateTime @default(now())
}

model Answer {
  attemptId         String
  examQuestionId    String
  selectedOptionIds String[]
  markedForReview   Boolean  @default(false)
  isCorrect         Boolean?
  marksAwarded      Decimal? @db.Decimal(6,2)
  updatedAt         DateTime @updatedAt
  @@id([attemptId, examQuestionId])
}

model ExamChangeLog {            // answer-key fixes and cancellations (PRD §5.14.1)
  id             String   @id @default(cuid())
  examId         String
  examQuestionId String
  change         Json     // { from, to } or { cancelled: true }
  changedBy      String
  createdAt      DateTime @default(now())
}

// ───────── Book shop & AI ─────────
model Book {
  id           String   @id @default(cuid())
  title        String
  author       String
  publisher    String?
  courseId     String?
  groupType    CourseGroup?
  classLevel   CourseClass?
  description  String?
  price        Decimal  @db.Decimal(10,2)
  coverId      String?            // public bucket
  pdfId        String             // private bucket
  previewPages Int[]              // 1-based page numbers
  previewPdfId String?            // private bucket
  publishedAt  DateTime?
  archivedAt   DateTime?
  createdAt    DateTime @default(now())
}

model BookPurchase {
  id            String        @id @default(cuid())
  studentId     String
  bookId        String
  price         Decimal       @db.Decimal(10,2)
  paymentStatus PaymentStatus @default(unlocked_no_gateway)
  purchasedAt   DateTime      @default(now())
  @@unique([studentId, bookId])
}

model AIConversation {
  id        String   @id @default(cuid())
  studentId String
  title     String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@index([studentId, updatedAt])
}

model AIMessage {
  id             String   @id @default(cuid())
  conversationId String                       // ON DELETE CASCADE
  role           AIRole
  content        String
  tokens         Int?
  createdAt      DateTime @default(now())
  @@index([conversationId, createdAt])
}

model AIUsage {
  studentId    String
  date         DateTime @db.Date             // Asia/Dhaka
  messageCount Int      @default(0)
  @@id([studentId, date])
}

// ───────── System ─────────
model StorageObject {
  id         String   @id @default(cuid())
  bucket     Bucket
  key        String   @unique
  mime       String
  size       Int
  originalName String?          // shown on download only, never used as the key
  uploadedBy String
  createdAt  DateTime @default(now())
  deletedAt  DateTime?          // purge job removes from storage after 30 days
  userAvatarOf User? @relation("UserAvatar")
  @@index([deletedAt])
}

model Setting {
  key       String   @id
  value     Json
  updatedBy String?
  updatedAt DateTime @updatedAt
}

model AuditLog {
  id         String   @id @default(cuid())
  actorId    String
  action     String           // "section.create", "student.move", "attendance.edit" ...
  targetType String
  targetId   String
  changes    Json?            // field names + non-personal old/new values only
  ip         String?
  createdAt  DateTime @default(now())
  @@index([targetType, targetId])
  @@index([createdAt])
}
```

Foreign keys: add `@relation` for every `*Id` column above (omitted where it adds noise). Default `onDelete: Restrict`; `Cascade` only for pure children (`PostMedia`, `CommentMedia`, `MaterialFile`, `NoticeAttachment`, `AIMessage`, `Answer`, `RoutineSlotOffering`, `ClassMeetingOffering`, `OnlineClassOffering`).

## 3. Raw SQL in migrations

```sql
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

-- AI grounding full-text search
ALTER TABLE material_chunks ADD COLUMN tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED;
CREATE INDEX material_chunks_tsv_idx ON material_chunks USING GIN (tsv);

-- Lock the Supabase REST API: RLS on, no policies, on EVERY table (repeat for new tables)
DO $$ DECLARE t text; BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP; END $$;
```

A CI test (`db.rls.test.ts`) fails if any table in `public` has `relrowsecurity = false`.

## 4. Settings keys (seeded)

| Key | Default | Used by |
|---|---|---|
| `attendance_threshold` | `75` | 04 |
| `attendance_colours` | `{ "green": 75, "orange": 60 }` | 04 |
| `grading_scale` | HSC: `[{min:80,g:"A+"},{min:70,g:"A"},{min:60,g:"A-"},{min:50,g:"B"},{min:40,g:"C"},{min:33,g:"D"},{min:0,g:"F"}]` | 05 |
| `ai_provider` | `"groq"` | 09 |
| `ai_model` | a free-tier Llama 70B-class model id, checked at build time | 09 |
| `ai_daily_limit` | `20` | 09 |
| `banned_words_enabled` | `false` | 06, 07 |
| `pin_days` | `7` | 06 |
| `email_daily_limit` | `450` | 07 |
| `maintenance_window` | `null` or `{ day, from, to }` (exam form warns on overlap, PRD §8) | 05 |
| `college_profile` | `{ name, about, departments, contact, logoId, bannerId }` | landing page |

## 5. Seed (`prisma/seed.ts`)

- The single Admin: `role=admin`, email from `SEED_ADMIN_EMAIL`, password from `SEED_ADMIN_PASSWORD`, `mustChangePassword=true`, no TOTP yet. Idempotent: never creates a second Admin (fails if one exists with a different email).
- Settings above. Example periods (Period 1 08:00–08:45 …) only when `SEED_DEMO=true`.
- Demo data script (`seed-demo.ts`, dev only): one session, 3 groups, 2 sections, 5 courses, 3 teachers, 60 students.
