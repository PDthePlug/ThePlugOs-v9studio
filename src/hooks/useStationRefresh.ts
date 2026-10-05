import { useEffect, useRef, useState } from 'react';

/** Refresh presentation through the existing bridge; never creates staff/device authority. */
export function useStationRefresh(refresh: () => Promise<void>, enabled: boolean) {
  const latest = useRef({refresh, enabled});
  latest.current = {refresh, enabled};
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    let disposed = false;
    let running = false;
    const update = async () => {
      if (disposed || running || !latest.current.enabled || document.visibilityState === 'hidden') return;
      running = true;
      try {
        await latest.current.refresh();
        if (!disposed) setUnavailable(false);
      } catch {
        if (!disposed) setUnavailable(true);
      } finally { running = false; }
    };
    const timer = window.setInterval(() => void update(), 2000);
    const resume = () => void update();
    window.addEventListener('focus', resume);
    document.addEventListener('visibilitychange', resume);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      window.removeEventListener('focus', resume);
      document.removeEventListener('visibilitychange', resume);
    };
  }, []);
  return unavailable;
}
