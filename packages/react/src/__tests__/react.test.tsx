import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PlugOSProvider, usePlugOS, useViewState } from '../index';
import { sdk } from '@plugos/sdk';
import { InMemoryStorageAdapter } from '@plugos/core/storage/adapters/in-memory';
import { stateEngine, eventEngine } from '@plugos/core';

const TestComponent = () => {
  const os = usePlugOS();
  return <div>{os ? 'SDK is available' : 'SDK is missing'}</div>;
};

const StateComponent = ({ entityType, entityId, refreshEvents }: any) => {
  const state = useViewState<{ count: number }>(entityType, entityId, refreshEvents);
  return <div data-testid="count">{state ? state.count : 'loading'}</div>;
};

describe('Phase 3 Sprint 2 - React UI Integration', () => {
  beforeEach(async () => {
    eventEngine['subscribers'].clear();
    eventEngine.subscribe('*', async (event: any) => {
      await stateEngine['processEvent'](event);
    });

    await sdk.boot({ storageAdapter: new InMemoryStorageAdapter() });
    
    // Setup state
    stateEngine.registerReducer('counter', (state, event) => {
      const s = state || { count: 0 };
      if (event.action === 'INCREMENT') s.count += 1;
      return s;
    });
  });

  it('PlugOSProvider should provide SDK context', () => {
    render(
      <PlugOSProvider sdk={sdk}>
        <TestComponent />
      </PlugOSProvider>
    );
    expect(screen.getByText('SDK is available')).toBeDefined();
  });

  it('useViewState should subscribe to CQRS projection', async () => {
    const { unmount } = render(
      <PlugOSProvider sdk={sdk}>
        <StateComponent entityType="counter" entityId="ctr-1" refreshEvents={['INCREMENT']} />
      </PlugOSProvider>
    );

    // Initial is loading
    expect(screen.getByTestId('count').textContent).toBe('loading');
    
    // Dispatch event
    await sdk.events.publish('ctr-1', 'counter', 'INCREMENT', {});

    // CQRS Projection is synchronous locally but React setState triggers re-render
    // Wait for effect
    const { waitFor } = await import('@testing-library/react');
    await waitFor(() => {
      expect(screen.getByTestId('count').textContent).toBe('1');
    });

    unmount();
  });
});
