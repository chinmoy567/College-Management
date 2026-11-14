import { randomInt } from 'node:crypto';

/** No 0/O, 1/l/I, so the printed slip can be read without mistakes. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const DIGITS = '23456789';

/** 12 characters from an unambiguous alphabet, at least one letter and one digit (crypto.randomInt). */
export function generatePassword(length = 12): string {
  for (;;) {
    const pw = Array.from({ length }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
    if ([...pw].some((c) => DIGITS.includes(c)) && /[A-Za-z]/.test(pw)) return pw;
  }
}
