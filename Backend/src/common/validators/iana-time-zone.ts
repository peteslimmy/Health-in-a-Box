import { ValidationOptions, registerDecorator } from 'class-validator';

export function isIanaTimeZone(value: unknown): boolean {
  if (typeof value !== 'string' || value.length === 0 || value.length > 60) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** The value must be a real IANA time zone, e.g. Africa/Lagos. A bad zone would otherwise break posting later. */
export function IsIanaTimeZone(options?: ValidationOptions) {
  return (object: object, propertyName: string) =>
    registerDecorator({
      name: 'isIanaTimeZone',
      target: object.constructor,
      propertyName,
      options: {
        message: 'timezone must be a valid IANA time zone such as Africa/Lagos',
        ...options,
      },
      validator: { validate: isIanaTimeZone },
    });
}
