import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  getUser: vi.fn(),
  signUp: vi.fn(),
  signInWithPassword: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  updateUser: vi.fn(),
}));
const rpc = vi.hoisted(() => vi.fn());

vi.mock('../lib/supabase', () => ({
  supabase: { auth, rpc },
}));

import { WelcomeScreen } from './WelcomeScreen';

describe('WelcomeScreen owner account signup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('does not render any owner credential field on an unconfigured portal', () => {
    vi.stubEnv('VITE_OWNER_PORTAL_ORIGIN', '');
    render(<WelcomeScreen onLoginSuccess={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Open ThePlugOS' }));

    expect(screen.getByRole('alert').textContent).toContain('Owner access is not configured for this portal yet.');
    expect(screen.queryByLabelText('Email address')).toBeNull();
    expect(screen.queryByLabelText('Password')).toBeNull();
  });

  it('creates no business before email confirmation and uses the clean confirmation redirect', async () => {
    vi.stubEnv('VITE_OWNER_PORTAL_ORIGIN', window.location.origin);
    vi.stubEnv('VITE_SUPABASE_URL', 'http://localhost:54321');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'sb_publishable_local_test');
    auth.getUser.mockResolvedValue({ data: { user: null }, error: null });
    auth.signUp.mockResolvedValue({
      data: {
        user: { id: 'owner-1', email_confirmed_at: null },
        session: null,
      },
      error: null,
    });

    render(<WelcomeScreen onLoginSuccess={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /Set up my business/i }));
    fireEvent.change(screen.getByLabelText('Business name'), { target: { value: 'Nomsa Takeaway' } });
    fireEvent.change(screen.getByLabelText('First branch name'), { target: { value: 'Cresta' } });
    fireEvent.change(screen.getByLabelText('Owner email address'), { target: { value: 'owner@example.test' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'a-strong-owner-password' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'a-strong-owner-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create owner account' }));

    await waitFor(() => {
      expect(auth.signUp).toHaveBeenCalledWith({
        email: 'owner@example.test',
        password: 'a-strong-owner-password',
        options: { emailRedirectTo: window.location.origin },
      });
    });
    expect(rpc).not.toHaveBeenCalled();
    expect(await screen.findByText(/Confirm your email, then sign in/i)).toBeDefined();
  });
});
