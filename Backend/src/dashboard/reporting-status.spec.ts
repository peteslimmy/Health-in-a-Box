import { D, allHospitalsUser, grant, makeUser } from '../testing/fixtures';
import { loadReportingStatus } from './reporting-status';

function build() {
  const prisma = {
    hospital: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'c1', code: 'AAA', name: 'Alpha' },
        { id: 'c2', code: 'BBB', name: 'Beta' },
        { id: 'c3', code: 'CCC', name: 'Gamma' },
      ]),
    },
    revenueReport: {
      groupBy: jest.fn().mockResolvedValue([
        { hospitalId: 'c1', _max: { periodEnd: D('2026-10-25') } },
        { hospitalId: 'c2', _max: { periodEnd: D('2026-10-10') } },
      ]),
    },
    importBatch: {
      groupBy: jest
        .fn()
        .mockResolvedValue([{ hospitalId: 'c2', _max: { periodEnd: D('2026-10-24') } }]),
    },
  };
  return prisma;
}

describe('loadReportingStatus', () => {
  const today = '2026-10-27';

  it('counts a pending upload as well as a committed report, and lists late hospitals first, then the longest-waiting', async () => {
    const result = await loadReportingStatus(build() as never, allHospitalsUser('u'), today);
    expect(result.map((c) => [c.code, c.late, c.lastReportEnd])).toEqual([
      ['CCC', true, null],
      ['BBB', false, '2026-10-24'],
      ['AAA', false, '2026-10-25'],
    ]);
  });

  it('limits a scoped user to their hospitals and hides other hospitals', async () => {
    const prisma = build();
    const scoped = makeUser('s', [grant('R', ['dashboard.read'], ['c1'])]);
    await loadReportingStatus(prisma as never, scoped, today);
    expect(prisma.hospital.findMany.mock.calls[0][0].where).toMatchObject({
      status: 'ACTIVE',
      id: { in: ['c1'] },
    });
    await expect(loadReportingStatus(prisma as never, scoped, today, 'c2')).rejects.toMatchObject({
      status: 404,
    });
  });
});
