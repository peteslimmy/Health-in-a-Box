import { allCentresUser } from '../testing/fixtures';
import { CentresService } from './centres.service';

describe('centre creation', () => {
  const create = jest.fn(async ({ data }) => ({ id: 'c-new', ...data }));
  const service = new CentresService(
    { centre: { create } } as never,
    { record: jest.fn() } as never,
  );
  const dto = { code: 'NEW-1', name: 'New Centre' } as never;

  it('is limited to people with access to all centres', async () => {
    const scoped = {
      ...allCentresUser('scoped', ['centres.create']),
      allCentres: false,
      centreIds: ['a'],
    };
    await expect(service.create(scoped, dto)).rejects.toMatchObject({
      response: { code: 'ALL_CENTRES_REQUIRED' },
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('works for an all-centres user', async () => {
    await expect(
      service.create(allCentresUser('boss', ['centres.create']), dto),
    ).resolves.toMatchObject({ code: 'NEW-1' });
  });
});
