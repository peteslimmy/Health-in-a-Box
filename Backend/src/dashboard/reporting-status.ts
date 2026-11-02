import { ImportStatus } from '@prisma/client';
import { AuthUser } from '../common/types/auth-user';
import { assertCentreAccess } from '../common/utils/scope';
import { PrismaService } from '../prisma/prisma.service';
import { ReportingStatus, reportingStatus } from './collection-rate';

export type CentreReportingStatus = ReportingStatus & {
  centreId: string;
  code: string;
  name: string;
};

const iso = (date: Date | null | undefined) => (date ? date.toISOString().slice(0, 10) : null);

/**
 * When did each active centre last report? A committed report or an upload still waiting to be
 * committed both count (D-203). Late centres come first, the longest-overdue at the top.
 */
export async function loadReportingStatus(
  prisma: PrismaService,
  user: AuthUser,
  today: string,
  centreId?: string,
): Promise<CentreReportingStatus[]> {
  if (centreId) assertCentreAccess(user, centreId);
  const centres = await prisma.centre.findMany({
    where: {
      organizationId: user.organizationId,
      status: 'ACTIVE',
      ...(centreId ? { id: centreId } : user.allCentres ? {} : { id: { in: user.centreIds } }),
    },
    select: { id: true, code: true, name: true },
    orderBy: { code: 'asc' },
  });
  const ids = centres.map((centre) => centre.id);
  const [committed, pending] = await Promise.all([
    prisma.revenueReport.groupBy({
      by: ['centreId'],
      where: { organizationId: user.organizationId, centreId: { in: ids }, status: 'COMMITTED' },
      _max: { periodEnd: true },
    }),
    prisma.importBatch.groupBy({
      by: ['centreId'],
      where: {
        organizationId: user.organizationId,
        centreId: { in: ids },
        status: { in: [ImportStatus.READY_TO_COMMIT, ImportStatus.PROCESSING] },
      },
      _max: { periodEnd: true },
    }),
  ]);
  const last = new Map<string, string>();
  for (const group of [...committed, ...pending]) {
    const end = iso(group._max.periodEnd);
    if (end && (!last.has(group.centreId) || end > (last.get(group.centreId) as string))) {
      last.set(group.centreId, end);
    }
  }
  return centres
    .map((centre) => ({
      centreId: centre.id,
      code: centre.code,
      name: centre.name,
      ...reportingStatus(today, last.get(centre.id) ?? null),
    }))
    .sort(
      (a, b) =>
        Number(b.late) - Number(a.late) ||
        (b.daysSince ?? Number.MAX_SAFE_INTEGER) - (a.daysSince ?? Number.MAX_SAFE_INTEGER) ||
        a.code.localeCompare(b.code),
    );
}
