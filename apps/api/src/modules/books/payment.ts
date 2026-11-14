import { Prisma } from '@prisma/client';
import { prisma } from '../../db';

/**
 * The only place a purchase is made. No money is collected (PRD 5.19, accepted); a real gateway would replace this
 * function without touching the student flow. Repeat calls return the existing purchase (unique student + book).
 */
export async function unlock(studentId: string, bookId: string): Promise<{ id: string; price: number; purchasedAt: Date; created: boolean }> {
  const existing = await prisma.bookPurchase.findUnique({ where: { studentId_bookId: { studentId, bookId } } });
  if (existing) return { id: existing.id, price: Number(existing.price), purchasedAt: existing.purchasedAt, created: false };
  try {
    const book = await prisma.book.findUniqueOrThrow({ where: { id: bookId }, select: { price: true } });
    const p = await prisma.bookPurchase.create({ data: { studentId, bookId, price: book.price, paymentStatus: 'unlocked_no_gateway' } });
    return { id: p.id, price: Number(p.price), purchasedAt: p.purchasedAt, created: true };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const p = await prisma.bookPurchase.findUniqueOrThrow({ where: { studentId_bookId: { studentId, bookId } } });
      return { id: p.id, price: Number(p.price), purchasedAt: p.purchasedAt, created: false };
    }
    throw e;
  }
}
