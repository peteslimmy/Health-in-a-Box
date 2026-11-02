import { fingerprintReport } from './report-fingerprint';

const lines = [
  { departmentId: 'd1', reportedTotal: '1000.00', amounts: { CASH: '600.00', POS: '400.00' } },
  { departmentId: 'd2', reportedTotal: '200.00', amounts: { POS: '200.00', CASH: '0.00' } },
];

describe('report fingerprint (duplicate detection)', () => {
  const base = () => fingerprintReport('c1', '2026-09-01', '2026-09-30', lines);

  it('is identical for the same content regardless of row or channel order', () => {
    const shuffled = [
      { ...lines[1], amounts: { CASH: '0.00', POS: '200.00' } },
      { ...lines[0], amounts: { POS: '400.00', CASH: '600.00' } },
    ];
    expect(fingerprintReport('c1', '2026-09-01', '2026-09-30', shuffled)).toBe(base());
  });

  it('changes when any figure, centre or period changes', () => {
    const changedAmount = [{ ...lines[0], amounts: { CASH: '601.00', POS: '399.00' } }, lines[1]];
    expect(fingerprintReport('c1', '2026-09-01', '2026-09-30', changedAmount)).not.toBe(base());
    expect(fingerprintReport('c2', '2026-09-01', '2026-09-30', lines)).not.toBe(base());
    expect(fingerprintReport('c1', '2026-10-01', '2026-10-31', lines)).not.toBe(base());
  });

  it('does not depend on the source file name or format', () => {
    // The fingerprint takes no file metadata at all, so a renamed re-send collides.
    expect(base()).toBe(base());
    expect(base()).toMatch(/^[0-9a-f]{64}$/);
  });
});
