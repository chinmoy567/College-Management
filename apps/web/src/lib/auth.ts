export type Role = 'admin' | 'teacher' | 'student';
export const HOME: Record<Role, string> = { admin: '/admin', teacher: '/teacher', student: '/student' };
export type MeUser = {
  id: string; role: Role; name: string; firstLogin: boolean; emailVerified: boolean;
  mustChangePassword?: boolean; isMentorOf?: string; mutedUntil?: string;
};
