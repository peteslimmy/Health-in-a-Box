import { NotFoundException } from '@nestjs/common';
import { grant, makeUser } from '../../testing/fixtures';
import { assertHospitalAccess, narrowUserScope } from './scope';

describe('hospital scope', () => {
  const A = 'hospital-a';
  const B = 'hospital-b';

  // A write role scoped to Hospital A, plus a read-only role across every hospital.
  const user = makeUser('u1', [
    grant('WRITER', ['imports.manage', 'hospitals.read'], [A]),
    grant('READER', ['hospitals.read'], 'ALL'),
  ]);

  it('does not let a write permission leak to hospitals only a read role covers', () => {
    const narrowed = narrowUserScope(user, ['imports.manage']);
    expect(narrowed).not.toBeNull();
    expect(narrowed!.allHospitals).toBe(false);
    expect(narrowed!.hospitalIds).toEqual([A]);
    expect(() => assertHospitalAccess(narrowed!, B)).toThrow(NotFoundException);
    expect(() => assertHospitalAccess(narrowed!, A)).not.toThrow();
  });

  it('gives the read permission its own, wider scope', () => {
    const narrowed = narrowUserScope(user, ['hospitals.read']);
    expect(narrowed!.allHospitals).toBe(true);
    expect(() => assertHospitalAccess(narrowed!, B)).not.toThrow();
  });

  it('denies a permission the user does not hold in any assignment', () => {
    expect(narrowUserScope(user, ['audit.read'])).toBeNull();
  });

  it('intersects scopes when an endpoint needs several permissions', () => {
    const narrowed = narrowUserScope(user, ['imports.manage', 'hospitals.read']);
    expect(narrowed!.allHospitals).toBe(false);
    expect(narrowed!.hospitalIds).toEqual([A]);
  });

  it('denies when the required permissions share no hospital', () => {
    const split = makeUser('u2', [
      grant('X', ['imports.manage'], [A]),
      grant('Y', ['charge_runs.post'], [B]),
    ]);
    expect(narrowUserScope(split, ['imports.manage', 'charge_runs.post'])).toBeNull();
  });

  it('does not mutate the original user', () => {
    narrowUserScope(user, ['imports.manage']);
    expect(user.allHospitals).toBe(true);
  });
});
