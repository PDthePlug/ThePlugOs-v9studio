import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
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

  it('allows a new visitor with no session to sign up, creates no business before email confirmation, and uses the clean confirmation redirect', async () => {
    vi.stubEnv('VITE_OWNER_PORTAL_ORIGIN', window.location.origin);
    vi.stubEnv('VITE_SUPABASE_URL', 'http://localhost:54321');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'sb_publishable_local_test');
    auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
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
    expect(auth.getUser).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(await screen.findByText(/Confirm your email, then sign in/i)).toBeDefined();
  });

  it('server-verifies an existing owner session before creating the business and does not sign up again', async () => {
    vi.stubEnv('VITE_OWNER_PORTAL_ORIGIN', window.location.origin);
    vi.stubEnv('VITE_SUPABASE_URL', 'http://localhost:54321');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'sb_publishable_local_test');
    const verifiedOwner = { id: 'owner-1', email: 'owner@example.test', email_confirmed_at: '2026-10-12T00:00:00Z' };
    auth.getSession.mockResolvedValue({ data: { session: { user: verifiedOwner } }, error: null });
    auth.getUser.mockResolvedValue({ data: { user: verifiedOwner }, error: null });
    rpc.mockResolvedValue({
      data: { business_id: 'business-1', branch_id: 'branch-1' },
      error: null,
    });
    const onLoginSuccess = vi.fn();

    render(<WelcomeScreen authenticatedOwnerId="owner-1" onLoginSuccess={onLoginSuccess} />);

    fireEvent.change(await screen.findByLabelText('Business name'), { target: { value: 'Nomsa Takeaway' } });
    fireEvent.change(screen.getByLabelText('First branch name'), { target: { value: 'Cresta' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create business' }));

    await waitFor(() => expect(auth.getUser).toHaveBeenCalledTimes(1));
    expect(auth.signUp).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith('create_business_with_owner_and_branch', {
      business_name: 'Nomsa Takeaway',
      branch_name: 'Cresta',
      branch_location: null,
    });
    await waitFor(() => expect(onLoginSuccess).toHaveBeenCalledWith({ ownerId: 'owner-1', preferredBusinessId: 'business-1' }));
  });
});