export type PasswordStrength = {
  /** 0 = nothing typed, 1 = very weak ... 4 = strong. */
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
  tips: string[];
};

const LABELS = ['', 'Very weak', 'Weak', 'Good', 'Strong'] as const;
const COMMON = ['password', 'passw0rd', 'qwerty', 'letmein', 'welcome', 'admin', 'abc123', 'iloveyou', 'hnb', 'receivables', '123456', '111111'];

const hasSequence = (value: string) => {
  const lower = value.toLowerCase();
  for (let i = 0; i + 2 < lower.length; i += 1) {
    const a = lower.charCodeAt(i);
    const b = lower.charCodeAt(i + 1);
    const c = lower.charCodeAt(i + 2);
    if (b - a === 1 && c - b === 1) return true; // abc, 123
  }
  return false;
};

/**
 * A quick, local estimate to guide people choosing a password. It is advice only: the server
 * decides what is accepted, and nothing typed here leaves the browser.
 */
export function scorePassword(value: string): PasswordStrength {
  if (!value) return { score: 0, label: '', tips: [] };

  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((pattern) => pattern.test(value)).length;
  const lower = value.toLowerCase();
  const tips: string[] = [];

  let points = 0;
  if (value.length >= 8) points += 1;
  if (value.length >= 12) points += 1;
  if (value.length >= 16) points += 1;
  if (classes >= 3) points += 1;
  if (classes === 4 && value.length >= 12) points += 1;

  if (/(.)\1{2,}/.test(value)) points -= 1;
  if (hasSequence(value)) points -= 1;
  if (COMMON.some((word) => lower.includes(word))) points -= 2;
  if (classes === 1) points -= 1;

  if (value.length < 12) tips.push('Use 12 or more characters');
  if (classes < 3) tips.push('Mix upper and lower case, numbers and symbols');
  if (COMMON.some((word) => lower.includes(word))) tips.push('Avoid common words');
  if (/(.)\1{2,}/.test(value) || hasSequence(value)) tips.push('Avoid repeats and sequences like abc or 123');

  let score = Math.max(1, Math.min(4, points));
  if (value.length < 8) score = 1;
  const level = score as 1 | 2 | 3 | 4;
  return { score: level, label: LABELS[level], tips };
}
