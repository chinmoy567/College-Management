import type { Role } from './auth';

export type NavItem = { href: string; label: string; icon: string };

/** Bottom tab bar (5 max, the last is always "More") and the More sheet per role (spec 10 §3). */
export const TABS: Record<Role, NavItem[]> = {
  student: [
    { href: '/student', label: 'Home', icon: '🏠' },
    { href: '/feed', label: 'Feed', icon: '📰' },
    { href: '/student/courses', label: 'Courses', icon: '📚' },
    { href: '/messages', label: 'Messages', icon: '💬' },
  ],
  teacher: [
    { href: '/teacher', label: 'Today', icon: '🏠' },
    { href: '/teacher/content', label: 'Courses', icon: '📚' },
    { href: '/feed', label: 'Feed', icon: '📰' },
    { href: '/messages', label: 'Messages', icon: '💬' },
  ],
  admin: [
    { href: '/admin', label: 'Dashboard', icon: '🏠' },
    { href: '/admin/students', label: 'Students', icon: '🎓' },
    { href: '/admin/schedule', label: 'Schedule', icon: '🗓️' },
    { href: '/feed', label: 'Feed', icon: '📰' },
  ],
};

const common: NavItem[] = [
  { href: '/notices', label: 'Notices', icon: '📢' },
  { href: '/notifications', label: 'Notifications', icon: '🔔' },
  { href: '/profile', label: 'My profile', icon: '👤' },
];

export const MORE: Record<Role, NavItem[]> = {
  student: [
    { href: '/student/routine', label: 'Routine', icon: '🕒' },
    { href: '/student/attendance', label: 'Attendance', icon: '✅' },
    { href: '/student/exams', label: 'Exams', icon: '📝' },
    { href: '/student/progress', label: 'Progress', icon: '📈' },
    { href: '/student/books', label: 'Book Shop', icon: '📖' },
    { href: '/student/my-books', label: 'My Books', icon: '🔓' },
    { href: '/student/ai', label: 'AI study helper', icon: '🤖' },
    ...common,
  ],
  teacher: [
    { href: '/teacher/attendance', label: 'Attendance', icon: '✅' },
    { href: '/teacher/exams', label: 'Exams', icon: '📝' },
    ...common,
  ],
  admin: [
    { href: '/admin/sessions', label: 'Sessions', icon: '🏫' },
    { href: '/admin/teachers', label: 'Teachers', icon: '👩‍🏫' },
    { href: '/admin/courses', label: 'Courses', icon: '📚' },
    { href: '/admin/mentors', label: 'Section Mentors', icon: '🧭' },
    { href: '/admin/students/new', label: 'Add student', icon: '➕' },
    { href: '/admin/students/import', label: 'Import students (CSV)', icon: '📥' },
    { href: '/admin/moderation', label: 'Moderation', icon: '🛡️' },
    { href: '/admin/library', label: 'College library', icon: '🗂️' },
    { href: '/admin/books', label: 'Book shop', icon: '📖' },
    { href: '/admin/ai', label: 'AI usage', icon: '🤖' },
    ...common,
  ],
};

export const isActive = (path: string, href: string, root: string) => (href === root ? path === href : path === href || path.startsWith(href + '/'));
