// frontend/src/components/IncomingCallModal.tsx
import React, { useEffect, useState } from 'react';
import { Phone, PhoneOff, Video, X, Volume2 } from 'lucide-react';
import { getAvatarColor, getInitials, truncateAddress } from '@/utils/helpers';

interface IncomingCallModalProps {
  isOpen: boolean;
  callerName: string;
  callerId: string;
  callerAvatar?: string;
  callType: 'audio' | 'video';
  onAnswer: () => void;
  onDecline: () => void;
}

export default function IncomingCallModal({
  isOpen,
  callerName,
  callerId,
  callerAvatar,
  callType,
  onAnswer,
  onDecline
}: IncomingCallModalProps) {
  const [pulseRing, setPulseRing] = useState(true);

  // Pulse animation for the avatar ring
  useEffect(() => {
    if (!isOpen) return;
    const interval = setInterval(() => {
      setPulseRing(prev => !prev);
    }, 1000);
    return () => clearInterval(interval);
  }, [isOpen]);

  if (!isOpen) return null;

  const displayName = callerName || truncateAddress(callerId);
  const avatarBg = getAvatarColor(callerId);

  return (
    <div className="fixed inset-0 bg-black/95 z-[100] flex flex-col items-center justify-center">
      {/* Background animation */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-gradient-to-r from-primary-500/20 to-purple-500/20 rounded-full blur-3xl animate-pulse" />
      </div>

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center">
        {/* Call type indicator */}
        <div className="flex items-center gap-2 mb-6 px-4 py-2 bg-white/10 rounded-full">
          {callType === 'video' ? (
            <Video size={18} className="text-primary-400" />
          ) : (
            <Phone size={18} className="text-primary-400" />
          )}
          <span className="text-white/80 text-sm">
            Incoming {callType === 'video' ? 'Video' : 'Voice'} Call
          </span>
        </div>

        {/* Avatar with pulse ring */}
        <div className="relative mb-6">
          {/* Pulse rings */}
          <div className={`absolute inset-0 rounded-full border-2 border-primary-500/50 animate-ping`} 
               style={{ animationDuration: '1.5s' }} />
          <div className={`absolute -inset-3 rounded-full border border-primary-500/30 ${pulseRing ? 'scale-110 opacity-0' : 'scale-100 opacity-100'} transition-all duration-1000`} />
          <div className={`absolute -inset-6 rounded-full border border-primary-500/20 ${!pulseRing ? 'scale-110 opacity-0' : 'scale-100 opacity-100'} transition-all duration-1000`} />
          
          {/* Avatar */}
          <div className={`w-28 h-28 rounded-full flex items-center justify-center overflow-hidden border-4 border-primary-500/50 ${avatarBg}`}>
            {callerAvatar ? (
              <img 
                src={callerAvatar} 
                alt={displayName} 
                className="w-full h-full object-cover"
              />
            ) : (
              <span className="text-4xl font-bold text-white">
                {getInitials(displayName)}
              </span>
            )}
          </div>
        </div>

        {/* Caller info */}
        <h2 className="text-2xl font-bold text-white mb-2">{displayName}</h2>
        {callerName && callerId && (
          <p className="text-gray-400 text-sm mb-8">{truncateAddress(callerId)}</p>
        )}
        {!callerName && (
          <p className="text-gray-400 text-sm mb-8">is calling you...</p>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-12">
          {/* Decline button */}
          <div className="flex flex-col items-center gap-2">
            <button
              onClick={onDecline}
              className="w-16 h-16 bg-red-500 hover:bg-red-600 rounded-full flex items-center justify-center transition-all hover:scale-110 shadow-lg shadow-red-500/30"
            >
              <PhoneOff size={28} className="text-white" />
            </button>
            <span className="text-gray-400 text-sm">Decline</span>
          </div>

          {/* Answer button */}
          <div className="flex flex-col items-center gap-2">
            <button
              onClick={onAnswer}
              className="w-16 h-16 bg-green-500 hover:bg-green-600 rounded-full flex items-center justify-center transition-all hover:scale-110 shadow-lg shadow-green-500/30 animate-bounce"
              style={{ animationDuration: '1s' }}
            >
              {callType === 'video' ? (
                <Video size={28} className="text-white" />
              ) : (
                <Phone size={28} className="text-white" />
              )}
            </button>
            <span className="text-gray-400 text-sm">Answer</span>
          </div>
        </div>

        {/* Swipe hint for mobile */}
        <p className="mt-12 text-gray-500 text-xs">
          Tap to answer or decline
        </p>
      </div>
    </div>
  );
}
