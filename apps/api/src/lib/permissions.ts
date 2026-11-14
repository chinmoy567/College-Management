// Signatures of the policy helpers (docs/spec/00-conventions.md §4). DB-backed bodies arrive in M2/M3.
export interface Actor {
  id: string;
  role: 'admin' | 'teacher' | 'student';
}

const notBuilt = (name: string): never => {
  throw new Error(`${name} is not implemented yet (M2/M3)`);
};

export const isAdmin = (actor: Actor): boolean => actor.role === 'admin';
export const teachesOffering = (_actor: Actor, _offeringId: string): Promise<boolean> => notBuilt('teachesOffering');
export const mentorsSection = (_actor: Actor, _sectionId: string): Promise<boolean> => notBuilt('mentorsSection');
export const teachesInSection = (_actor: Actor, _sectionId: string): Promise<boolean> => notBuilt('teachesInSection');
export const canManageOffering = (_actor: Actor, _offeringId: string): Promise<boolean> => notBuilt('canManageOffering');
export const isEnrolled = (_studentId: string, _offeringId: string): Promise<boolean> => notBuilt('isEnrolled');
export const canTakeAttendance = (_actor: Actor, _meetingId: string): Promise<boolean> => notBuilt('canTakeAttendance');
export const canSeeStudentPrivate = (actor: Actor, studentId: string): boolean =>
  isAdmin(actor) || actor.id === studentId;
