import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../lib/api';
import { renderWithProviders } from '../test/utils';
import { LoginPage } from './LoginPage';

const hoisted = vi.hoisted(() => ({
  auth: { status: 'signedOut', user: null, signIn: vi.fn(), completeSession: vi.fn() } as Record<string, unknown>,
}));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => hoisted.auth }));
vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api');
  return { ...actual, api: vi.fn() };
});

describe('sign in', () => {
  beforeEach(() => {
    hoisted.auth.status = 'signedOut';
    (hoisted.auth.signIn as ReturnType<typeof vi.fn>).mockReset();
  });

  it('keeps the button disabled until both fields are filled', async () => {
    renderWithProviders(<LoginPage />);
    const button = screen.getByRole('button', { name: 'Sign in' });
    expect(button).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Email'), 'a@b.co');
    expect(button).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Password'), 'secret');
    expect(button).toBeEnabled();
  });

  it('submits trimmed credentials', async () => {
    const signIn = hoisted.auth.signIn as ReturnType<typeof vi.fn>;
    signIn.mockResolvedValue(undefined);
    renderWithProviders(<LoginPage />);
    await userEvent.type(screen.getByLabelText('Email'), '  a@b.co ');
    await userEvent.type(screen.getByLabelText('Password'), 'secret');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(signIn).toHaveBeenCalledWith('a@b.co', 'secret'));
  });

  it('shows the server\'s message when sign-in fails, without revealing which field was wrong', async () => {
    (hoisted.auth.signIn as ReturnType<typeof vi.fn>).mockRejectedValue(new ApiError(401, 'UNAUTHENTICATED', 'Invalid email or password'));
    renderWithProviders(<LoginPage />);
    await userEvent.type(screen.getByLabelText('Email'), 'a@b.co');
    await userEvent.type(screen.getByLabelText('Password'), 'bad');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');
  });

  it('shows a loading state while the existing session is being restored', () => {
    hoisted.auth.status = 'loading';
    renderWithProviders(<LoginPage />);
    expect(screen.getByText('Checking your session…')).toBeInTheDocument();
  });
});

describe('second step of sign-in', () => {
  const apiMock = api as unknown as ReturnType<typeof vi.fn>;
  const signIn = hoisted.auth.signIn as ReturnType<typeof vi.fn>;
  const completeSession = hoisted.auth.completeSession as ReturnType<typeof vi.fn>;

  async function passwordStep() {
    renderWithProviders(<LoginPage />);
    await userEvent.type(screen.getByLabelText('Email'), 'a@b.co');
    await userEvent.type(screen.getByLabelText('Password'), 'secret-1234');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  }

  beforeEach(() => {
    hoisted.auth.status = 'signedOut';
    signIn.mockReset();
    completeSession.mockReset().mockResolvedValue(undefined);
    apiMock.mockReset();
  });

  it('asks for the code instead of entering the app, and sends it with the challenge token', async () => {
    signIn.mockResolvedValue({ stage: 'verify', token: 'tok-1' });
    apiMock.mockResolvedValue({ accessToken: 'access-1' });
    await passwordStep();
    expect(await screen.findByLabelText('Authentication code')).toBeInTheDocument();
    expect(completeSession).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText('Authentication code'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() => expect(completeSession).toHaveBeenCalledWith('access-1'));
    expect(apiMock).toHaveBeenCalledWith('/auth/mfa/verify', { method: 'POST', body: { mfaToken: 'tok-1', code: '123456' } });
  });

  it('shows the server message for a wrong code and stays on the code step', async () => {
    signIn.mockResolvedValue({ stage: 'verify', token: 'tok-1' });
    apiMock.mockRejectedValue(new ApiError(401, 'MFA_CODE_INVALID', 'That code is not right or was already used'));
    await passwordStep();
    await userEvent.type(await screen.findByLabelText('Authentication code'), '000000');
    await userEvent.click(screen.getByRole('button', { name: 'Verify' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('not right');
    expect(completeSession).not.toHaveBeenCalled();
  });

  it('lets the person switch to a recovery code', async () => {
    signIn.mockResolvedValue({ stage: 'verify', token: 'tok-1' });
    apiMock.mockResolvedValue({ accessToken: 'access-2', recoveryCodesRemaining: 6 });
    await passwordStep();
    await userEvent.click(await screen.findByRole('button', { name: 'Use a recovery code' }));
    await userEvent.type(screen.getByLabelText('Recovery code'), 'AB12C-D34EF');
    await userEvent.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() => expect(completeSession).toHaveBeenCalledWith('access-2'));
    expect(apiMock).toHaveBeenCalledWith('/auth/mfa/verify', { method: 'POST', body: { mfaToken: 'tok-1', recoveryCode: 'AB12C-D34EF' } });
  });

  it('walks a required first-time set-up and opens the app only after the recovery codes are saved', async () => {
    signIn.mockResolvedValue({ stage: 'enrol', token: 'tok-2' });
    apiMock.mockImplementation(async (path: string) => {
      if (path === '/auth/mfa/enrol/start') return { secret: 'JBSWY3DPEHPK3PXP', otpauthUri: 'otpauth://totp/x' };
      return { accessToken: 'access-3', recoveryCodes: ['AAAAA-11111', 'BBBBB-22222'] };
    });
    await passwordStep();
    expect(await screen.findByTestId('mfa-secret')).toHaveTextContent('JBSW Y3DP EHPK 3PXP');
    expect(screen.getByText(/can approve or change money/i)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('6-digit code'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm and continue' }));

    expect(await screen.findByText('AAAAA-11111')).toBeInTheDocument();
    expect(completeSession).not.toHaveBeenCalled();
    const proceed = screen.getByRole('button', { name: 'Continue to the app' });
    expect(proceed).toBeDisabled();
    await userEvent.click(screen.getByLabelText('I have saved these recovery codes'));
    await userEvent.click(proceed);
    await waitFor(() => expect(completeSession).toHaveBeenCalledWith('access-3'));
  });

  it('goes back to the password step when the person starts over', async () => {
    signIn.mockResolvedValue({ stage: 'verify', token: 'tok-1' });
    await passwordStep();
    await userEvent.click(await screen.findByRole('button', { name: 'Start over' }));
    expect(await screen.findByLabelText('Password')).toHaveValue('');
  });
});

