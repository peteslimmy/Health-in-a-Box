import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { Modal } from './ui';

// The form state lives in the host and onClose is a new function on every render, as on the real pages.
function Host() {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  return (
    <>
      <button onClick={() => setOpen(true)}>Open</button>
      {open && (
        <Modal title="Add item" onClose={() => setOpen(false)}>
          <input aria-label="Name" value={value} onChange={(event) => setValue(event.target.value)} />
          <button>Save</button>
        </Modal>
      )}
    </>
  );
}

describe('Modal', () => {
  it('keeps focus in the field while typing several characters', async () => {
    render(<Host />);
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    const input = screen.getByLabelText('Name');
    await userEvent.click(input);
    await userEvent.keyboard('abc');
    expect(input).toHaveValue('abc');
    expect(input).toHaveFocus();
  });

  it('keeps Tab inside the dialog and returns focus to the opener on Escape', async () => {
    render(<Host />);
    const opener = screen.getByRole('button', { name: 'Open' });
    await userEvent.click(opener);
    await userEvent.tab();
    await userEvent.tab();
    await userEvent.tab();
    await userEvent.tab();
    await userEvent.tab();
    expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
  });
});
