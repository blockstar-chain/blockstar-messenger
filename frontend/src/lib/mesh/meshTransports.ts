// frontend/src/lib/mesh/meshTransports.ts
// Convenience bootstrap: turn on the extra transports + walkie-talkie after the
// core mesh has been initialized. Call once, after meshNetworkService.initialize().

import { meshNetworkService } from './MeshNetworkService';
import { walkieTalkieService } from './WalkieTalkieService';
import { wifiDirectMeshBridge } from './WifiDirectMeshBridge';
import { localMeshService } from './LocalMeshService';

interface StartOpts {
  username?: string;
  walkieTalkie?: boolean; // default true
  wifiDirect?: boolean;   // default true (Android only; no-ops elsewhere)
  localWifi?: boolean;    // default true (native only; needs LocalMeshPlugin)
  channel?: string;       // walkie-talkie channel, default 'main'
}

export async function startMeshTransports(opts: StartOpts = {}): Promise<void> {
  const { walletAddress, username } = meshNetworkService.getIdentity();
  if (!walletAddress) {
    console.warn('[meshTransports] mesh not initialized — call meshNetworkService.initialize() first');
    return;
  }

  if (opts.walkieTalkie !== false) {
    walkieTalkieService.initialize({
      myAddress: walletAddress,
      myName: opts.username ?? username,
      channel: opts.channel,
    });
  }

  if (opts.wifiDirect !== false) {
    wifiDirectMeshBridge.start().catch((e) => console.warn('[meshTransports] wifiDirect', e));
  }

  if (opts.localWifi !== false) {
    localMeshService.start().catch((e) => console.warn('[meshTransports] localWifi', e));
  }
}

export async function stopMeshTransports(): Promise<void> {
  walkieTalkieService.shutdown();
  await wifiDirectMeshBridge.stop().catch(() => {});
  await localMeshService.stop().catch(() => {});
}
