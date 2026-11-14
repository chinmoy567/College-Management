import { ApiError } from './api';

export const errMsg = (e: unknown): string => (e instanceof ApiError ? e.message : 'Something went wrong. Try again.');
export const fieldErrors = (e: unknown): Record<string, string> => (e instanceof ApiError && e.fields ? e.fields : {});

export interface SectionLite { id: string; name: string; classLevel: number; mentorTeacherId: string | null; studentCount: number }
export interface GroupLite { id: string; type: 'science' | 'commerce' | 'arts'; sectionCount: number; studentCount: number; sections: SectionLite[] }
export interface SessionRow { id: string; name: string; status: 'active' | 'closed'; closedAt: string | null; groups: GroupLite[] }
export interface Teacher { id: string; name: string; designation: string | null; subjects: string[]; loginId: string | null; matches: boolean }
export interface Course { id: string; code: string; name: string; groupType: string; classLevel: string; paper: string; isOptional: boolean; archivedAt: string | null }
export interface SectionDetail {
  id: string; name: string; classLevel: number; freePlaces: number;
  group: { id: string; type: string }; session: { id: string; name: string; status: string };
  mentor: { id: string; name: string } | null;
  students: { id: string; name: string; roll: string; loginId: string | null; status: string }[];
  offerings: { id: string; course: Pick<Course, "id" | "code" | "name" | "isOptional">; teacher: { id: string; name: string } }[];
}
export const groupLabel = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
export const sectionLabel = (s: { classLevel: number; name: string }) => `Class ${s.classLevel} · Section ${s.name}`;
