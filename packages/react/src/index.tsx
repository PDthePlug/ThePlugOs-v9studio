import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { PlugOS } from '@plugos/sdk';

const PlugOSContext = createContext<PlugOS | null>(null);

export const PlugOSProvider: React.FC<{ sdk: PlugOS; children: ReactNode }> = ({ sdk, children }) => {
  return <PlugOSContext.Provider value={sdk}>{children}</PlugOSContext.Provider>;
};

export const usePlugOS = (): PlugOS => {
  const context = useContext(PlugOSContext);
  if (!context) {
    throw new Error('usePlugOS must be used within a PlugOSProvider');
  }
  return context;
};

// Hook for subscribing to a specific CQRS State view
export const useViewState = <T = any>(entityType: string, entityId: string, refreshEventTypes: string[]): T | null => {
  const sdk = usePlugOS();
  const [state, setState] = useState<T | null>(null);

  useEffect(() => {
    let mounted = true;
    
    // Initial fetch
    sdk.state.query(entityType, entityId).then(data => {
      if (mounted) setState(data);
    });

    const unsubs = refreshEventTypes.map(type => 
      sdk.events.subscribe(type, async (evt) => {
        if (evt.entityType === entityType && evt.entityId === entityId) {
          const freshData = await sdk.state.query(entityType, entityId);
          if (mounted) setState(freshData);
        }
      })
    );

    return () => {
      mounted = false;
      unsubs.forEach(unsub => unsub());
    };
  }, [sdk, entityType, entityId, JSON.stringify(refreshEventTypes)]);

  return state;
};
