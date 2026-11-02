import { describe, expect, it } from 'vitest';
import { scorePassword } from './passwordStrength';

describe('password strength estimate', () => {
  it('shows nothing until something is typed', () => {
    expect(scorePassword('')).toEqual({ score: 0, label: '', tips: [] });
  });

  it('rates short and common passwords low', () => {
    expect(scorePassword('abc').score).toBe(1);
    expect(scorePassword('Password1234').score).toBeLessThanOrEqual(2);
    expect(scorePassword('qwertyqwerty').score).toBeLessThanOrEqual(2);
    expect(scorePassword('aaaaaaaaaaaa').score).toBe(1);
  });

  it('rates long, varied passwords high', () => {
    expect(scorePassword('Tr0ub4dor&Fountain-Pen!').score).toBe(4);
    expect(scorePassword('Xodmansky%12').score).toBeGreaterThanOrEqual(3);
  });

  it('never rates a password under 8 characters above very weak', () => {
    expect(scorePassword('Aa1!Aa1').score).toBe(1);
  });

  it('gets stronger as length and variety grow', () => {
    const steps = ['sunrise', 'sunrise2026', 'Sunrise2026!', 'Sunrise2026!Harbour'].map((p) => scorePassword(p).score);
    expect([...steps].sort((a, b) => a - b)).toEqual(steps);
  });

  it('explains what would help', () => {
    expect(scorePassword('hello').tips).toEqual(expect.arrayContaining(['Use 12 or more characters']));
    expect(scorePassword('password12345').tips).toContain('Avoid common words');
  });
});
