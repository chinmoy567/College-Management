// Policy helpers (docs/spec/00-conventions.md §4). Pure rules over a small data-access interface;
// the Prisma-backed PermissionStore is wired in M1/M3 when the schema exists.
export interface Actor {
  id: string;
  role: 'admin' | 'teacher' | 'student';
}

export interface PermissionStore {
  /** CourseOffering: its teacher and section. */
  getOffering(id: string): Promise<{ teacherId: string | null; sectionId: string } | null>;
  /** Section: its mentor teacher. */
  getSection(id: string): Promise<{ mentorTeacherId: string | null } | null>;
  /** True when the teacher teaches any offering of the section. */
  teachesAnyOfferingInSection(teacherId: string, sectionId: string): Promise<boolean>;
  /** True when an `active` Enrollment exists. */
  hasActiveEnrollment(studentId: string, offeringId: string): Promise<boolean>;
  /** ClassMeeting: teacher, substitute and the sections it covers. */
  getMeeting(
    id: string,
  ): Promise<{ teacherId: string | null; substituteId: string | null; sectionIds: string[] } | null>;
}

export const isAdmin = (actor: Actor): boolean => actor.role === 'admin';

/** Private fields are visible only to the student themself and the Admin (PRD §8 Privacy). */
export const canSeeStudentPrivate = (actor: Actor, studentId: string): boolean =>
  isAdmin(actor) || actor.id === studentId;

export function createPermissions(store: PermissionStore) {
  const teachesOffering = async (actor: Actor, offeringId: string): Promise<boolean> => {
    if (actor.role !== 'teacher') return false;
    const o = await store.getOffering(offeringId);
    return !!o && o.teacherId === actor.id;
  };

  const mentorsSection = async (actor: Actor, sectionId: string): Promise<boolean> => {
    if (actor.role !== 'teacher') return false;
    const s = await store.getSection(sectionId);
    return !!s && s.mentorTeacherId === actor.id;
  };

  const teachesInSection = async (actor: Actor, sectionId: string): Promise<boolean> =>
    actor.role === 'teacher' && store.teachesAnyOfferingInSection(actor.id, sectionId);

  /** Mentors count only where the PRD matrix gives them the right (`mentorAllowed`, e.g. recordings/notes). */
  const canManageOffering = async (
    actor: Actor,
    offeringId: string,
    opts: { mentorAllowed?: boolean } = {},
  ): Promise<boolean> => {
    if (isAdmin(actor)) return true;
    if (actor.role !== 'teacher') return false;
    const o = await store.getOffering(offeringId);
    if (!o) return false;
    if (o.teacherId === actor.id) return true;
    return !!opts.mentorAllowed && (await mentorsSection(actor, o.sectionId));
  };

  const isEnrolled = (studentId: string, offeringId: string): Promise<boolean> =>
    store.hasActiveEnrollment(studentId, offeringId);

  const canTakeAttendance = async (actor: Actor, meetingId: string): Promise<boolean> => {
    if (isAdmin(actor)) return true;
    if (actor.role !== 'teacher') return false;
    const m = await store.getMeeting(meetingId);
    if (!m) return false;
    if (m.teacherId === actor.id || m.substituteId === actor.id) return true;
    for (const sectionId of m.sectionIds) if (await mentorsSection(actor, sectionId)) return true;
    return false;
  };

  return { teachesOffering, mentorsSection, teachesInSection, canManageOffering, isEnrolled, canTakeAttendance };
}
