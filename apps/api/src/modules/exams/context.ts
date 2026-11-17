import { prisma } from '../../db';

/** Which class an exam belongs to (course + session + group + section + class level), same shape as the attendance sheet. */
export type OfferingContext = {
  course: { id: string; code: string; name: string };
  session: string;
  group: string;
  section: string;
  classLevel: number;
};

const include = {
  course: { select: { id: true, code: true, name: true } },
  section: { select: { name: true, classLevel: true, group: { select: { type: true, session: { select: { name: true } } } } } },
} as const;

type Row = { course: OfferingContext['course']; section: { name: string; classLevel: number; group: { type: string; session: { name: string } } } };

export const contextOf = (o: Row): OfferingContext => ({
  course: o.course, session: o.section.group.session.name, group: o.section.group.type, section: o.section.name, classLevel: o.section.classLevel,
});

export async function offeringContext(offeringId: string): Promise<OfferingContext> {
  return contextOf(await prisma.courseOffering.findUniqueOrThrow({ where: { id: offeringId }, include }));
}

/** One query for many offerings (lists). */
export async function offeringContexts(offeringIds: string[]): Promise<Map<string, OfferingContext>> {
  const rows = await prisma.courseOffering.findMany({ where: { id: { in: [...new Set(offeringIds)] } }, include });
  return new Map(rows.map((o) => [o.id, contextOf(o)]));
}
