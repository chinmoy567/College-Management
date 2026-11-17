export type MentorFlag = 'low_attendance' | 'below_pass' | 'inactive';

export interface MentorOverview {
  section: { id: string; name: string; classLevel: number; group: string; session: string };
  chatConversationId: string | null;
  thresholds: { attendance: number; inactiveDays: number };
  summary: { students: number; attendancePct: number | null; lowAttendance: number; belowPass: number; inactive: number };
}

export interface MentorStudent {
  id: string; name: string; roll: string; loginId: string | null; avatarUrl: string | null;
  attendancePct: number | null; examAvgPct: number | null; lastActiveAt: string | null; flags: MentorFlag[];
}

export interface MentorStudentDetail extends MentorStudent {
  attendance: { offeringId: string; course: string; pct: number | null; present: number; held: number }[];
  exams: { offeringId: string; course: string; examId: string; title: string; score: number | null; totalMarks: number; passMarks: number; passed: boolean }[];
}

export const FLAG_LABEL: Record<MentorFlag, string> = { low_attendance: 'Low attendance', below_pass: 'Below pass mark', inactive: 'Inactive' };
export const pct = (v: number | null): string => (v === null ? 'N/A' : `${v}%`);
