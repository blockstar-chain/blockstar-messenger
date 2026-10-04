// frontend/src/components/BlockedUsersSettings.tsx
// Settings panel: list of blocked users with Unblock buttons.
import React from 'react';
import toast from 'react-hot-toast';
import { useAppStore } from '@/store';
import { useBlockStore } from '@/store/blockStore';
import { getProfileByWallet } from '@/lib/profileResolver';
import { truncateAddress } from '@/utils/helpers';

export default function BlockedUsersSettings() {
  const currentUser = useAppStore((s) => s.currentUser);
  const blocked = useBlockStore((s) => s.blocked);
  const loaded = useBlockStore((s) => s.loaded);

  const handleUnblock = async (wallet: string) => {
    if (!currentUser) return;
    const ok = await useBlockStore.getState().unblock(currentUser.walletAddress, wallet);
    ok ? toast.success('User unblocked') : toast.error('Could not unblock user');
  };

  if (!loaded) {
    return <p className="text-sm text-muted p-4 bg-card border border-midnight rounded-xl">Loading…</p>;
  }

  if (blocked.length === 0) {
    return (
      <p className="text-sm text-muted p-4 bg-card border border-midnight rounded-xl">
        You haven't blocked anyone. Block someone from the ⋮ menu in a chat or from their profile.
      </p>
    );
  }

  return (
    <div className="bg-card border border-midnight rounded-xl divide-y divide-midnight">
      {blocked.map(({ walletAddress }) => {
        const profile: any = getProfileByWallet(walletAddress);
        const label = profile?.username ? `@${profile.username}` : truncateAddress(walletAddress);
        return (
          <div key={walletAddress} className="flex items-center justify-between gap-3 p-3">
            <div className="min-w-0">
              <p className="text-sm text-white truncate">{label}</p>
              {profile?.username && (
                <p className="text-xs text-muted truncate">{truncateAddress(walletAddress)}</p>
              )}
            </div>
            <button
              onClick={() => handleUnblock(walletAddress)}
              className="px-3 py-1.5 text-xs rounded-lg bg-dark-200 hover:bg-dark-100 text-white transition flex-shrink-0"
            >
              Unblock
            </button>
          </div>
        );
      })}
    </div>
  );
}
