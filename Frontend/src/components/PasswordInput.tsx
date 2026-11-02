import { useState, type InputHTMLAttributes, type KeyboardEvent } from 'react';
import { scorePassword } from '../lib/passwordStrength';
import { cx } from './ui';

const SEGMENT_COLOURS = ['', 'bg-red-500', 'bg-amber-500', 'bg-lime-500', 'bg-emerald-600'];
const LABEL_COLOURS = ['text-slate-500', 'text-red-700', 'text-amber-700', 'text-lime-700', 'text-emerald-700'];

/** Four bars that fill (and change colour) as the password gets stronger. Advice only. */
export function PasswordStrengthMeter({ value }: { value: string }) {
  const { score, label, tips } = scorePassword(value);
  return (
    <div className={cx('transition-all duration-300', value ? 'max-h-24 pb-1 opacity-100' : 'max-h-0 overflow-hidden opacity-0')} data-testid="strength-meter">
      <div className="flex gap-1.5" aria-hidden="true">
        {[1, 2, 3, 4].map((segment) => (
          <div key={segment} className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-900/10">
            <div
              className={cx(
                'h-full origin-left rounded-full transition-transform duration-500 ease-out motion-reduce:transition-none',
                segment <= score ? `scale-x-100 ${SEGMENT_COLOURS[score]}` : 'scale-x-0',
              )}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex items-baseline justify-between gap-2 text-xs">
        <span role="status" aria-live="polite" className={cx('font-medium transition-colors duration-300', LABEL_COLOURS[score])}>
          {label ? `Strength: ${label}` : ''}
        </span>
        {tips[0] && score < 4 && <span className="truncate text-slate-500">{tips[0]}</span>}
      </div>
    </div>
  );
}

function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
      {off && <path d="M4 4l16 16" />}
    </svg>
  );
}

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'> & {
  value: string;
  onChange: (value: string) => void;
  /** Show the animated strength bars (for choosing a password, or as a hint while typing one). */
  showStrength?: boolean;
  /** Classes for the text box itself (used to restyle it on the glass sign-in card). */
  inputClassName?: string;
};

const BASE = 'w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 pr-11 text-sm shadow-sm placeholder:text-slate-400 disabled:bg-slate-100';

/** A password box with a show/hide button, a Caps Lock warning and an optional strength meter. */
export function PasswordInput({ value, onChange, showStrength = false, inputClassName, className, onKeyDown, onKeyUp, onBlur, ...rest }: Props) {
  const [visible, setVisible] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const track = (event: KeyboardEvent<HTMLInputElement>) => setCapsLock(event.getModifierState?.('CapsLock') ?? false);

  return (
    <div className={cx('space-y-2', className)}>
      <div className="relative">
        <input
          {...rest}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            track(event);
            onKeyDown?.(event);
          }}
          onKeyUp={(event) => {
            track(event);
            onKeyUp?.(event);
          }}
          onBlur={(event) => {
            setCapsLock(false);
            onBlur?.(event);
          }}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className={cx(BASE, inputClassName)}
        />
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
          className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-slate-500 transition-colors hover:text-brand-700"
        >
          <EyeIcon off={visible} />
        </button>
      </div>
      {capsLock && (
        <p role="status" className="flex items-center gap-1.5 text-xs font-medium text-amber-800">
          <span aria-hidden="true">⇪</span> Caps Lock is on
        </p>
      )}
      {showStrength && <PasswordStrengthMeter value={value} />}
    </div>
  );
}
