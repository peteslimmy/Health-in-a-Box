import { ImportStatus } from '@prisma/client';
import { AuthUser } from '../common/types/auth-user';
import { assertHospitalAccess } from '../common/utils/scope';
import { PrismaService } from '../prisma/prisma.service';
import { ReportingStatus, reportingStatus } from './collection-rate';

export type HospitalReportingStatus = ReportingStatus & {
  hospitalId: string;
  code: string;
  name: string;
};

const iso = (date: Date | null | undefined) => (date ? date.toISOString().slice(0, 10) : null);

/**
 * When did each active hospital last report? A committed report or an upload still waiting to be
 * committed both count (D-203). Late hospitals come first, the longest-overdue at the top.
 */
export async function loadReportingStatus(
  prisma: PrismaService,
  user: AuthUser,
  today: string,
  hospitalId?: string,
): Promise<HospitalReportingStatus[]> {
  if (hospitalId) assertHospitalAccess(user, hospitalId);
  const hospitals = await prisma.hospital.findMany({
    where: {
      organizationId: user.organizationId,
      status: 'ACTIVE',
      ...(hospitalId
        ? { id: hospitalId }
        : user.allHospitals
          ? {}
          : { id: { in: user.hospitalIds } }),
    },
    select: { id: true, code: true, name: true },
    orderBy: { code: 'asc' },
  });
  const ids = hospitals.map((hospital) => hospital.id);
  const [committed, pending] = await Promise.all([
    prisma.revenueReport.groupBy({
      by: ['hospitalId'],
      where: { organizationId: user.organizationId, hospitalId: { in: ids }, status: 'COMMITTED' },
      _max: { periodEnd: true },
    }),
    prisma.importBatch.groupBy({
      by: ['hospitalId'],
      where: {
        organizationId: user.organizationId,
        hospitalId: { in: ids },
        status: { in: [ImportStatus.READY_TO_COMMIT, ImportStatus.PROCESSING] },
      },
      _max: { periodEnd: true },
    }),
  ]);
  const last = new Map<string, string>();
  for (const group of [...committed, ...pending]) {
    const end = iso(group._max.periodEnd);
    if (end && (!last.has(group.hospitalId) || end > (last.get(group.hospitalId) as string))) {
      last.set(group.hospitalId, end);
    }
  }
  return hospitals
    .map((hospital) => ({
      hospitalId: hospital.id,
      code: hospital.code,
      name: hospital.name,
      ...reportingStatus(today, last.get(hospital.id) ?? null),
    }))
    .sort(
      (a, b) =>
        Number(b.late) - Number(a.late) ||
        (b.daysSince ?? Number.MAX_SAFE_INTEGER) - (a.daysSince ?? Number.MAX_SAFE_INTEGER) ||
        a.code.localeCompare(b.code),
    );
}
