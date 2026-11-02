import { NotFoundException } from '@nestjs/common';
import { grant, makeUser } from '../../testing/fixtures';
import { assertCentreAccess, narrowUserScope } from './scope';

describe('centre scope', () => {
  const A = 'centre-a';
  const B = 'centre-b';

  // A write role scoped to Centre A, plus a read-only role across every centre.
  const user = makeUser('u1', [
    grant('WRITER', ['imports.manage', 'centres.read'], [A]),
    grant('READER', ['centres.read'], 'ALL'),
  ]);

  it('does not let a write permission leak to centres only a read role covers', () => {
    const narrowed = narrowUserScope(user, ['imports.manage']);
    expect(narrowed).not.toBeNull();
    expect(narrowed!.allCentres).toBe(false);
    expect(narrowed!.centreIds).toEqual([A]);
    expect(() => assertCentreAccess(narrowed!, B)).toThrow(NotFoundException);
    expect(() => assertCentreAccess(narrowed!, A)).not.toThrow();
  });

  it('gives the read permission its own, wider scope', () => {
    const narrowed = narrowUserScope(user, ['centres.read']);
    expect(narrowed!.allCentres).toBe(true);
    expect(() => assertCentreAccess(narrowed!, B)).not.toThrow();
  });

  it('denies a permission the user does not hold in any assignment', () => {
    expect(narrowUserScope(user, ['audit.read'])).toBeNull();
  });

  it('intersects scopes when an endpoint needs several permissions', () => {
    const narrowed = narrowUserScope(user, ['imports.manage', 'centres.read']);
    expect(narrowed!.allCentres).toBe(false);
    expect(narrowed!.centreIds).toEqual([A]);
  });

  it('denies when the required permissions share no centre', () => {
    const split = makeUser('u2', [
      grant('X', ['imports.manage'], [A]),
      grant('Y', ['charge_runs.post'], [B]),
    ]);
    expect(narrowUserScope(split, ['imports.manage', 'charge_runs.post'])).toBeNull();
  });

  it('does not mutate the original user', () => {
    narrowUserScope(user, ['imports.manage']);
    expect(user.allCentres).toBe(true);
  });
});
