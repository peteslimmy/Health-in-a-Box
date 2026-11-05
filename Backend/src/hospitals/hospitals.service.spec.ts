import { allHospitalsUser, superAdminUser } from '../testing/fixtures';
import { HospitalsService } from './hospitals.service';

describe('hospital creation', () => {
  const create = jest.fn(async ({ data }) => ({ id: 'c-new', ...data }));
  const service = new HospitalsService(
    { hospital: { create } } as never,
    { record: jest.fn() } as never,
  );
  const dto = { code: 'NEW-1', name: 'New Hospital' } as never;

  it('is limited to the super admin, whatever the permissions', async () => {
    const admin = allHospitalsUser('admin', ['hospitals.create', 'hospitals.update']);
    await expect(service.create(admin, dto)).rejects.toMatchObject({
      response: { code: 'SUPER_ADMIN_REQUIRED' },
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('is limited to a super admin with access to all hospitals', async () => {
    const scoped = {
      ...superAdminUser('scoped', ['hospitals.create']),
      allHospitals: false,
      hospitalIds: ['a'],
    };
    await expect(service.create(scoped, dto)).rejects.toMatchObject({
      response: { code: 'ALL_HOSPITALS_REQUIRED' },
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('works for the super admin', async () => {
    await expect(
      service.create(superAdminUser('boss', ['hospitals.create']), dto),
    ).resolves.toMatchObject({ code: 'NEW-1' });
  });
});
