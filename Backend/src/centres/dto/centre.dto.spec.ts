import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { isIanaTimeZone } from '../../common/validators/iana-time-zone';
import { CreateCentreDto } from './centre.dto';

const base = { code: 'HNB-1', name: 'Centre One' };
const errorsFor = async (extra: Record<string, unknown>) =>
  (await validate(plainToInstance(CreateCentreDto, { ...base, ...extra }))).map((e) => e.property);

describe('centre input validation', () => {
  it('accepts real IANA time zones', async () => {
    expect(await errorsFor({ timezone: 'Africa/Lagos' })).toEqual([]);
    expect(await errorsFor({ timezone: 'UTC' })).toEqual([]);
    expect(await errorsFor({})).toEqual([]);
  });

  it.each(['Lagos', 'Not/AZone', '', '../../etc/passwd', 'A'.repeat(80), '<script>'])(
    'rejects the time zone %j',
    async (zone) => {
      expect(await errorsFor({ timezone: zone })).toContain('timezone');
    },
  );

  it('checks the helper directly', () => {
    expect(isIanaTimeZone('America/New_York')).toBe(true);
    expect(isIanaTimeZone(undefined)).toBe(false);
    expect(isIanaTimeZone(42)).toBe(false);
  });
});
