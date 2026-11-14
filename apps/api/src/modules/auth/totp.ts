import { generateSecret, generateSync, generateURI } from 'otplib';
import QRCode from 'qrcode';
import argon2 from 'argon2';
import { prisma } from '../../db';
import { decrypt, encrypt, generateBackupCode, hashPassword } from '../../lib/crypto';
import { AppError } from '../../lib/http';
import { revoke } from './sessions';

const PERIOD = 30;
export const MAX_TOTP_FAILURES = 5;
const stepNow = (): number => Math.floor(Date.now() / 1000 / PERIOD);

/** Returns the matching time-step (window ±1) or null. */
export function matchStep(secret: string, code: string): number | null {
  const now = stepNow();
  for (const step of [now, now - 1, now + 1]) {
    if (generateSync({ secret, epoch: step * PERIOD }) === code) return step;
  }
  return null;
}
export const codeAt = (secret: string, epochSeconds: number): string => generateSync({ secret, epoch: epochSeconds });

export async function beginSetup(userId: string, email: string) {
  const secret = generateSecret();
  await prisma.user.update({ where: { id: userId }, data: { totpPendingSecretEnc: encrypt(secret) } });
  const uri = generateURI({ issuer: 'College Management', label: email, secret });
  return { otpauthUri: uri, qrDataUrl: await QRCode.toDataURL(uri), secret };
}

export async function makeBackupCodes(): Promise<{ plain: string[]; hashes: string[] }> {
  const plain = Array.from({ length: 10 }, generateBackupCode);
  return { plain, hashes: await Promise.all(plain.map((c) => hashPassword(c))) };
}

export async function enable(userId: string, code: string): Promise<string[]> {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (u.totpEnabledAt) throw new AppError('CONFLICT', 409, 'Two-step login is already on.');
  if (!u.totpPendingSecretEnc) throw new AppError('VALIDATION_ERROR', 400, 'Start the setup first.');
  const secret = decrypt(u.totpPendingSecretEnc);
  const step = matchStep(secret, code);
  if (step === null) throw new AppError('INVALID_CODE', 400, 'That code is not correct.');
  const { plain, hashes } = await makeBackupCodes();
  await prisma.user.update({
    where: { id: userId },
    data: {
      totpSecretEnc: u.totpPendingSecretEnc,
      totpPendingSecretEnc: null,
      totpEnabledAt: new Date(),
      totpLastStep: step,
      backupCodeHashes: hashes,
    },
  });
  return plain;
}

/** Verifies a TOTP code or backup code for the step-up session. Revokes the session after 5 failures. */
export async function verifyStepUp(
  sessionId: string,
  userId: string,
  input: { code?: string; backupCode?: string },
): Promise<void> {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  let ok = false;
  if (u.totpSecretEnc && input.code) {
    const step = matchStep(decrypt(u.totpSecretEnc), input.code);
    // Replay protection: the same (or an older) step is never accepted twice.
    if (step !== null && (u.totpLastStep === null || step > u.totpLastStep)) {
      const r = await prisma.user.updateMany({
        where: { id: userId, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] },
        data: { totpLastStep: step },
      });
      ok = r.count === 1;
    }
  } else if (input.backupCode) {
    for (const h of u.backupCodeHashes) {
      if (await argon2.verify(h, input.backupCode.toLowerCase()).catch(() => false)) {
        const r = await prisma.user.updateMany({
          where: { id: userId, backupCodeHashes: { has: h } },
          data: { backupCodeHashes: u.backupCodeHashes.filter((x) => x !== h) },
        });
        ok = r.count === 1;
        break;
      }
    }
  }
  if (ok) {
    await prisma.loginSession.update({ where: { id: sessionId }, data: { stepUpPending: false, totpFailures: 0 } });
    return;
  }
  const s = await prisma.loginSession.update({
    where: { id: sessionId },
    data: { totpFailures: { increment: 1 } },
  });
  if (s.totpFailures >= MAX_TOTP_FAILURES) {
    await revoke(sessionId);
    throw new AppError('SESSION_ENDED', 401, 'Too many wrong codes. Please log in again.');
  }
  throw new AppError('INVALID_CODE', 400, 'That code is not correct.');
}

export async function regenerateBackupCodes(userId: string): Promise<string[]> {
  const { plain, hashes } = await makeBackupCodes();
  await prisma.user.update({ where: { id: userId }, data: { backupCodeHashes: hashes } });
  return plain;
}
