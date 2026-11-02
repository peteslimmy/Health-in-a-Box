import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { PasswordInput } from './PasswordInput';

function Harness({ showStrength = true }: { showStrength?: boolean }) {
  const [value, setValue] = useState('');
  return <PasswordInput aria-label="Secret" value={value} onChange={setValue} showStrength={showStrength} />;
}

describe('password box', () => {
  it('hides the password until asked, and hides it again', async () => {
    render(<Harness />);
    const box = screen.getByLabelText('Secret');
    await userEvent.type(box, 'hunter2');
    expect(box).toHaveAttribute('type', 'password');
    await userEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(box).toHaveAttribute('type', 'text');
    expect(box).toHaveValue('hunter2');
    await userEvent.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(box).toHaveAttribute('type', 'password');
  });

  it('shows nothing about strength until typing starts, then follows the password', async () => {
    render(<Harness />);
    expect(screen.queryByText(/Strength:/)).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Secret'), 'abc');
    expect(screen.getByText('Strength: Very weak')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Secret'), 'Tr0ub4dor&Fountain-Pen!');
    expect(screen.getByText('Strength: Strong')).toBeInTheDocument();
  });

  it('does not show the meter when it is not asked for', async () => {
    render(<Harness showStrength={false} />);
    await userEvent.type(screen.getByLabelText('Secret'), 'abc');
    expect(screen.queryByTestId('strength-meter')).not.toBeInTheDocument();
  });

  it('warns when Caps Lock is on and clears the warning on leaving the box', () => {
    render(<Harness />);
    const box = screen.getByLabelText('Secret');
    fireEvent.keyDown(box, { key: 'A', modifierCaps: true, getModifierState: () => true });
    fireEvent.keyUp(box, { key: 'A', modifierCapsLock: true });
    expect(screen.getByText(/Caps Lock is on/)).toBeInTheDocument();
    fireEvent.blur(box);
    expect(screen.queryByText(/Caps Lock is on/)).not.toBeInTheDocument();
  });
});
