import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MarketingLanding } from './MarketingLanding';

describe('MarketingLanding', () => {
  it('introduces the operating system in plain language', () => {
    render(
      <MarketingLanding
        onSignIn={vi.fn()}
        onCreateBusiness={vi.fn()}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Your whole business. Moving as one.' })).toBeDefined();
    expect(screen.getByText('When the internet stops, the shop does not.')).toBeDefined();
    expect(screen.getByText('Every person sees the work that belongs to them.')).toBeDefined();
  });

  it('routes owner, business-setup and staff entry through their intended access flows', () => {
    const onSignIn = vi.fn();
    const onCreateBusiness = vi.fn();

    render(
      <MarketingLanding
        onSignIn={onSignIn}
        onCreateBusiness={onCreateBusiness}
      />,
    );

    fireEvent.click(screen.getAllByRole('button', { name: 'Owner sign in' })[0]);
    fireEvent.click(screen.getByRole('button', { name: /Set up my business/i }));
    fireEvent.click(screen.getByRole('button', { name: 'I’m staff' }));

    expect(screen.getByRole('dialog', { name: 'Start your shift on your shop device.' })).toBeDefined();
    expect(screen.getByText(/Staff PINs are never entered into the public website or owner portal/i)).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'I’m the owner instead' }));

    expect(onSignIn).toHaveBeenCalledTimes(2);
    expect(onCreateBusiness).toHaveBeenCalledOnce();
  });
});
