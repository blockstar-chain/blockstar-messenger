// frontend/src/hooks/useNotificationPrompt.ts
// Shows the iOS/Android notification permission popup when the app opens, instead
// of only after wallet connect + signature (which was never reached on iOS because
// signing was stuck). This ONLY asks for permission so the popup appears; the token
// registration + backend association still happen in initializePushNotifications
// once the wallet is connected.
//
// NOTE (iOS): the system popup only appears if:
//   - running on a real device (not the Simulator),
//   - the "Push Notifications" capability is enabled in Xcode,
//   - the user hasn't already denied it once (iOS won't re-prompt — they'd have to
//     enable it in Settings). Consider showing your own "enable in Settings" hint
//     if checkPermissions() returns 'denied'.

import { useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';

interface Options {
  /** Delay (ms) before prompting, so the app UI is visible first. Default 800. */
  delayMs?: number;
  /** Called with the resulting permission state ('granted' | 'denied' | 'prompt'). */
  onResult?: (state: string) => void;
}

export function useNotificationPrompt(options: Options = {}) {
  const { delayMs = 800, onResult } = options;
  const askedRef = useRef(false);

  useEffect(() => {
    if (askedRef.current) return;
    if (!Capacitor.isNativePlatform()) return;
    askedRef.current = true;

    let timer: ReturnType<typeof setTimeout>;

    const ask = async () => {
      try {
        // Dynamic import so web builds don't pull the native plugin.
        const { PushNotifications } = await import('@capacitor/push-notifications');

        let status = await PushNotifications.checkPermissions();

        if (status.receive === 'prompt' || status.receive === 'prompt-with-rationale') {
          status = await PushNotifications.requestPermissions(); // <-- this shows the popup
        }

        onResult?.(status.receive);

        // If granted, kick off registration now so the APNs/FCM token starts flowing.
        // (initializePushNotifications will still associate it with the wallet later.)
        if (status.receive === 'granted') {
          try {
            await PushNotifications.register();
          } catch (e) {
            console.warn('[useNotificationPrompt] register() failed', e);
          }
        }
      } catch (e) {
        console.warn('[useNotificationPrompt] permission prompt failed', e);
      }
    };

    timer = setTimeout(ask, delayMs);
    return () => clearTimeout(timer);
  }, [delayMs, onResult]);
}
