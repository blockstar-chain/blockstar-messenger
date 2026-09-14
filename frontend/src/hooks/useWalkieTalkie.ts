// frontend/src/hooks/useWalkieTalkie.ts
// React hook wrapping WalkieTalkieService.

import { useCallback, useEffect, useState } from 'react';
import { walkieTalkieService, WalkieStatus } from '@/lib/mesh/WalkieTalkieService';

interface UseWalkieTalkieOptions {
  myAddress: string;
  myName?: string;
  channel?: string;
  enabled?: boolean; // set false to not initialize (e.g. mesh not ready yet)
}

export function useWalkieTalkie(options: UseWalkieTalkieOptions) {
  const { myAddress, myName, channel, enabled = true } = options;

  const [status, setStatus] = useState<WalkieStatus>(() => walkieTalkieService.getStatus());

  useEffect(() => {
    if (!enabled || !myAddress) return;
    walkieTalkieService.initialize({ myAddress, myName, channel });
    const unsub = walkieTalkieService.onStatus(setStatus);
    return () => {
      unsub();
      // Note: we don't shutdown on unmount so PTT keeps working across screens.
      // Call walkieTalkieService.shutdown() explicitly on logout.
    };
  }, [enabled, myAddress, myName, channel]);

  const startTalking = useCallback(() => walkieTalkieService.startTalking(), []);
  const stopTalking = useCallback(() => walkieTalkieService.stopTalking(), []);
  const setChannel = useCallback((c: string) => walkieTalkieService.setChannel(c), []);

  return {
    status,
    isTransmitting: status.isTransmitting,
    remoteTalkers: status.remoteTalkers,
    connectedPeers: status.connectedPeers,
    error: status.error,
    startTalking,
    stopTalking,
    setChannel,
  };
}
