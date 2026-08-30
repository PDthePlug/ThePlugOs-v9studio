import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RoleHeader } from './RoleHeader';
import { UserSession } from '../types';

const session: UserSession = {
  userId: 'staff-1',
  userName: 'Pride Mokoena',
  role: 'OWNER',
  businessId: 'business-1',
  branchId: 'branch-1',
  branchName: 'Soweto Central',
  deviceId: 'front-counter',
  permissions: ['*'],
  shiftId: 'shift-1',
  sessionToken: 'trusted-session',
};

describe('RoleHeader', () => {
  it('shows the operator, branch, role and current operating state', () => {
    render(
      <RoleHeader
        session={session}
        hubAvailability="READY"
        cloudStatus="DISCONNECTED"
        outboxCount={4}
        onLockSession={vi.fn()}
        onOpenSyncDiagnostics={vi.fn()}
      />,
    );

    expect(screen.getByText('Owner')).toBeDefined();
    expect(screen.getByText('Soweto Central')).toBeDefined();
    expect(screen.getByText('Pride Mokoena')).toBeDefined();
    expect(screen.getByText('Hub continues locally')).toBeDefined();
    expect(screen.getByText('4 awaiting acknowledgement')).toBeDefined();
  });

  it('keeps session actions behind the system menu and hides unimplemented enrollment', () => {
    const onPair = vi.fn();
    const onLock = vi.fn();

    render(
      <RoleHeader
        session={session}
        hubAvailability="READY"
        cloudStatus="UNKNOWN"
        outboxCount={0}
        onLockSession={onLock}
        onOpenPairingWizard={onPair}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'System' }));
    expect(screen.queryByRole('button', { name: /Pair a tablet/i })).toBeNull();
    expect(onPair).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Lock this station/i }));
    expect(onLock).toHaveBeenCalledOnce();
  });
});
