const COMMON = new Set(
  ['password', 'password1', 'password123', '12345678', '123456789', '1234567890', 'qwertyui', 'qwerty123', 'iloveyou',
   '11111111', '00000000', 'abc12345', 'admin123', 'welcome1', 'letmein1', 'college123', 'student123', 'teacher123',
   'bangladesh', 'dhaka1234', 'passw0rd', 'changeme'],
);

/** Returns an error message, or null when the password is acceptable (02 §4). */
export function checkPassword(pw: string, ctx: { loginId?: string | null; initialMatches?: boolean }): string | null {
  if (pw.length < 8) return 'Use at least 8 characters.';
  if (ctx.initialMatches) return 'Choose a password different from your initial password.';
  if (ctx.loginId && pw.toLowerCase() === ctx.loginId.toLowerCase()) return 'Password cannot be your login ID.';
  if (COMMON.has(pw.toLowerCase())) return 'That password is too common.';
  return null;
}
