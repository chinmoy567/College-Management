/**
 * Auto-submits one in-progress exam attempt (05 §4). Until M7 attempts cannot exist, so this is a no-op stub
 * with its final signature; pass-out calls it for every running attempt before leaving the chats (ACAD-10).
 */
export async function finaliseAttempt(_attemptId: string, _reason: 'passed_out' | 'deadline' | 'manual'): Promise<void> {
  // TODO(M7): score and close the attempt exactly like a student submit.
}
