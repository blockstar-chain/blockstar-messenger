// frontend/src/lib/platform.ts
// Single source of truth for "what am I running on?".
//
// Why this exists: the old check only looked for window.electronAPI, so
//   - the iOS app running on a Mac (TestFlight "install on Mac") was treated as a
//     phone and shown the mobile ConnectKit modal, and
//   - an Electron build whose preload bridge failed silently fell back to the web
//     modal with no error.
// Kinds:
//   'electron'   - Windows/macOS/Linux desktop app (Electron)
//   'ios-on-mac' - the iOS app running on Apple Silicon (or Mac Catalyst)
//   'ios' | 'android' - phones/tablets
//   'web'        - a normal browser

import { Capacitor, registerPlugin } from '@capacitor/core';

export type PlatformKind = 'electron' | 'ios-on-mac' | 'ios' | 'android' | 'web';

interface PlatformInfoPlugin {
  getInfo(): Promise<{ isiOSAppOnMac: boolean; isMacCatalyst: boolean }>;
  openExternal(options: { url: string }): Promise<{ opened: boolean }>;
}

// Native plugin (ios/App/App/PlatformInfo). Harmless on other platforms.
export const PlatformInfo = registerPlugin<PlatformInfoPlugin>('PlatformInfo');

let cached: PlatformKind | null = null;

/** Electron preload bridge is present and working. */
export function hasElectronBridge(): boolean {
  return typeof window !== 'undefined' && !!(window as any).electronAPI?.isElectron;
}

/** User agent says Electron, even if the preload bridge failed to load. */
export function looksLikeElectron(): boolean {
  return typeof navigator !== 'undefined' && / Electron\//.test(navigator.userAgent);
}

export async function detectPlatform(): Promise<PlatformKind> {
  if (cached) return cached;
  if (typeof window === 'undefined') return 'web';

  if (hasElectronBridge() || looksLikeElectron()) {
    cached = 'electron';
  } else {
    const p = Capacitor.getPlatform();
    if (p === 'ios') {
      try {
        const info = await PlatformInfo.getInfo();
        cached = info.isiOSAppOnMac || info.isMacCatalyst ? 'ios-on-mac' : 'ios';
      } catch {
        // Plugin not in this build: iPhones/iPads always report touch points,
        // an iOS app on a Mac reports none.
        cached = navigator.maxTouchPoints === 0 ? 'ios-on-mac' : 'ios';
      }
    } else if (p === 'android') {
      cached = 'android';
    } else {
      cached = 'web';
    }
  }

  console.log(
    `[Platform] ${cached} (electronBridge=${hasElectronBridge()}, electronUA=${looksLikeElectron()}, capacitor=${Capacitor.getPlatform()})`
  );
  return cached;
}

/** Last detected value (null until detectPlatform() has resolved once). */
export function getCachedPlatform(): PlatformKind | null {
  return cached;
}

/** Desktop kinds use the "open a browser, get a callback" wallet flow. */
export function isDesktopKind(kind: PlatformKind | null | undefined): boolean {
  return kind === 'electron' || kind === 'ios-on-mac';
}
