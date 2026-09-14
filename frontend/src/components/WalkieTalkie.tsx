// frontend/src/components/WalkieTalkie.tsx
// Push-to-talk UI. Hold the button (or the spacebar) to talk to everyone
// currently connected on the mesh channel.

'use client';

import React, { useEffect } from 'react';
import { Mic, Radio, Users, Volume2 } from 'lucide-react';
import { useWalkieTalkie } from '@/hooks/useWalkieTalkie';
import { unlockAudio } from '@/lib/mesh/voiceCodec';

interface WalkieTalkieProps {
  myAddress: string;
  myName?: string;
  channel?: string;
  enabled?: boolean;
}

export default function WalkieTalkie({ myAddress, myName, channel = 'main', enabled = true }: WalkieTalkieProps) {
  const { status, isTransmitting, remoteTalkers, connectedPeers, error, startTalking, stopTalking } =
    useWalkieTalkie({ myAddress, myName, channel, enabled });

  // Spacebar as PTT key (ignored while typing in inputs)
  useEffect(() => {
    const isTyping = () => {
      const el = document.activeElement as HTMLElement | null;
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
    };
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat && !isTyping()) {
        e.preventDefault();
        void startTalking();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isTyping()) {
        e.preventDefault();
        stopTalking();
      }
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [startTalking, stopTalking]);

  // iOS won't play received audio until AudioContext is unlocked by a gesture.
  // Unlock on the first interaction anywhere so pure listeners can hear talkers.
  useEffect(() => {
    const unlock = () => {
      void unlockAudio();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('touchstart', unlock);
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('touchstart', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('touchstart', unlock);
    };
  }, []);

  const someoneTalking = remoteTalkers.length > 0;

  return (
    <div className="flex flex-col items-center gap-3 p-4 select-none">
      <div className="flex items-center gap-2 text-xs text-gray-400">
        <Users size={14} />
        <span>{connectedPeers} connected</span>
        <span className="mx-1">·</span>
        <Radio size={14} />
        <span>#{status.channel}</span>
      </div>

      {/* Who's talking */}
      <div className="h-6 text-sm text-center">
        {isTransmitting ? (
          <span className="text-red-400 font-medium animate-pulse">You're talking…</span>
        ) : someoneTalking ? (
          <span className="text-green-400 font-medium flex items-center gap-1 justify-center">
            <Volume2 size={16} />
            {remoteTalkers.map((t) => t.name || short(t.address)).join(', ')} talking…
          </span>
        ) : (
          <span className="text-gray-500">Hold to talk</span>
        )}
      </div>

      {/* PTT button */}
      <button
        type="button"
        onMouseDown={() => void startTalking()}
        onMouseUp={stopTalking}
        onMouseLeave={() => isTransmitting && stopTalking()}
        onTouchStart={(e) => {
          e.preventDefault();
          void startTalking();
        }}
        onTouchEnd={(e) => {
          e.preventDefault();
          stopTalking();
        }}
        disabled={connectedPeers === 0}
        className={[
          'w-28 h-28 rounded-full flex items-center justify-center transition-all',
          'shadow-lg active:scale-95 touch-none',
          connectedPeers === 0
            ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
            : isTransmitting
              ? 'bg-red-500 text-white scale-105 ring-4 ring-red-500/40'
              : 'bg-emerald-500 hover:bg-emerald-400 text-white',
        ].join(' ')}
        aria-pressed={isTransmitting}
        aria-label="Push to talk"
      >
        <Mic size={40} />
      </button>

      <p className="text-[11px] text-gray-500">Hold the button or press Space</p>

      {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
    </div>
  );
}

function short(addr: string): string {
  return addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : 'unknown';
}
