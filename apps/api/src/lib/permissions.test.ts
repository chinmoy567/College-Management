import { describe, expect, it } from 'vitest';
import { canSeeStudentPrivate, createPermissions, isAdmin, type Actor, type PermissionStore } from './permissions';

const admin: Actor = { id: 'admin1', role: 'admin' };
const t1: Actor = { id: 't1', role: 'teacher' }; // teaches offering o1, mentors s1
const t2: Actor = { id: 't2', role: 'teacher' }; // substitute for m1
const t3: Actor = { id: 't3', role: 'teacher' }; // unrelated
const st: Actor = { id: 'st1', role: 'student' };

const store: PermissionStore = {
  getOffering: async (id) => (id === 'o1' ? { teacherId: 't4', sectionId: 's1' } : id === 'o2' ? { teacherId: 't1', sectionId: 's2' } : null),
  getSection: async (id) => (id === 's1' ? { mentorTeacherId: 't1' } : id === 's2' ? { mentorTeacherId: null } : null),
  teachesAnyOfferingInSection: async (tid, sid) => tid === 't4' && sid === 's1',
  hasActiveEnrollment: async (sid, oid) => sid === 'st1' && oid === 'o1',
  getMeeting: async (id) => (id === 'm1' ? { teacherId: 't4', substituteId: 't2', sectionIds: ['s1'] } : null),
};
const p = createPermissions(store);

describe('permissions', () => {
  it('[CONV-08] isAdmin allow/deny', () => {
    expect(isAdmin(admin)).toBe(true);
    expect(isAdmin(t1)).toBe(false);
    expect(isAdmin(st)).toBe(false);
  });

  it('[CONV-08] teachesOffering allow/deny', async () => {
    expect(await p.teachesOffering(t1, 'o2')).toBe(true);
    expect(await p.teachesOffering(t1, 'o1')).toBe(false);
    expect(await p.teachesOffering(t3, 'o2')).toBe(false);
    expect(await p.teachesOffering(t1, 'missing')).toBe(false);
    expect(await p.teachesOffering(st, 'o2')).toBe(false);
  });

  it('[CONV-08] mentorsSection allow/deny', async () => {
    expect(await p.mentorsSection(t1, 's1')).toBe(true);
    expect(await p.mentorsSection(t3, 's1')).toBe(false);
    expect(await p.mentorsSection(t1, 's2')).toBe(false);
    expect(await p.mentorsSection(t1, 'missing')).toBe(false);
    expect(await p.mentorsSection(admin, 's1')).toBe(false);
  });

  it('[CONV-08] teachesInSection allow/deny', async () => {
    expect(await p.teachesInSection({ id: 't4', role: 'teacher' }, 's1')).toBe(true);
    expect(await p.teachesInSection(t1, 's1')).toBe(false); // mentor only, teaches nothing there
    expect(await p.teachesInSection(st, 's1')).toBe(false);
  });

  it('[CONV-08] canManageOffering allow/deny (mentor only where allowed)', async () => {
    expect(await p.canManageOffering(admin, 'o1')).toBe(true);
    expect(await p.canManageOffering({ id: 't4', role: 'teacher' }, 'o1')).toBe(true);
    expect(await p.canManageOffering(t1, 'o1')).toBe(false); // mentor, not allowed by default
    expect(await p.canManageOffering(t1, 'o1', { mentorAllowed: true })).toBe(true);
    expect(await p.canManageOffering(t3, 'o1', { mentorAllowed: true })).toBe(false);
    expect(await p.canManageOffering(st, 'o1')).toBe(false);
    expect(await p.canManageOffering(admin, 'missing')).toBe(true);
    expect(await p.canManageOffering(t1, 'missing')).toBe(false);
  });

  it('[CONV-08] isEnrolled allow/deny', async () => {
    expect(await p.isEnrolled('st1', 'o1')).toBe(true);
    expect(await p.isEnrolled('st1', 'o2')).toBe(false);
    expect(await p.isEnrolled('other', 'o1')).toBe(false);
  });

  it('[CONV-08] canTakeAttendance allow/deny', async () => {
    expect(await p.canTakeAttendance(admin, 'm1')).toBe(true);
    expect(await p.canTakeAttendance({ id: 't4', role: 'teacher' }, 'm1')).toBe(true); // meeting teacher
    expect(await p.canTakeAttendance(t2, 'm1')).toBe(true); // substitute
    expect(await p.canTakeAttendance(t1, 'm1')).toBe(true); // mentor of covered section
    expect(await p.canTakeAttendance(t3, 'm1')).toBe(false);
    expect(await p.canTakeAttendance(st, 'm1')).toBe(false);
    expect(await p.canTakeAttendance(t1, 'missing')).toBe(false);
  });

  it('[CONV-08] canSeeStudentPrivate allow/deny', () => {
    expect(canSeeStudentPrivate(admin, 'st1')).toBe(true);
    expect(canSeeStudentPrivate(st, 'st1')).toBe(true);
    expect(canSeeStudentPrivate({ id: 'st2', role: 'student' }, 'st1')).toBe(false);
    expect(canSeeStudentPrivate(t1, 'st1')).toBe(false);
  });
});
