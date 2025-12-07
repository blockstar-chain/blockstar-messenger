// frontend/src/components/RingtoneSettings.tsx
'use client';

import React, { useState, useEffect } from 'react';
import { Phone, PhoneOutgoing, MessageSquare, Volume2, VolumeX, Play, Square, Check } from 'lucide-react';
import { ringtoneService, RingtoneSettings, RingtoneOption, RINGTONES } from '@/lib/ringtones';

interface RingtoneSettingsPanelProps {
  onClose?: () => void;
}

export default function RingtoneSettingsPanel({ onClose }: RingtoneSettingsPanelProps) {
  const [settings, setSettings] = useState<RingtoneSettings>(ringtoneService.getSettings());
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [expandedCategory, setExpandedCategory] = useState<'incoming' | 'outgoing' | 'message' | null>(null);

  // Stop preview when component unmounts
  useEffect(() => {
    return () => {
      ringtoneService.stopPreview();
    };
  }, []);

  const handleSelectRingtone = (category: 'incoming' | 'outgoing' | 'message', id: string) => {
    const key = category === 'incoming' ? 'incomingCall' 
              : category === 'outgoing' ? 'outgoingCall' 
              : 'messageSound';
    
    ringtoneService.updateSettings({ [key]: id });
    setSettings(ringtoneService.getSettings());
  };

  const handlePreview = async (id: string) => {
    if (playingId === id) {
      // Stop if already playing
      ringtoneService.stopPreview();
      setPlayingId(null);
    } else {
      setPlayingId(id);
      await ringtoneService.previewRingtone(id);
      // Auto-clear after preview ends
      setTimeout(() => setPlayingId(null), 3000);
    }
  };

  const handleCallVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const volume = parseFloat(e.target.value);
    ringtoneService.setCallVolume(volume);
    setSettings(ringtoneService.getSettings());
  };

  const handleMessageVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const volume = parseFloat(e.target.value);
    ringtoneService.setMessageVolume(volume);
    setSettings(ringtoneService.getSettings());
  };

  const getSelectedRingtone = (category: 'incoming' | 'outgoing' | 'message'): RingtoneOption | undefined => {
    const id = category === 'incoming' ? settings.incomingCall
             : category === 'outgoing' ? settings.outgoingCall
             : settings.messageSound;
    return ringtoneService.getRingtoneById(id);
  };

  const renderRingtoneSelector = (
    category: 'incoming' | 'outgoing' | 'message',
    icon: React.ReactNode,
    title: string,
    description: string
  ) => {
    const options = ringtoneService.getRingtonesByCategory(category);
    const selected = getSelectedRingtone(category);
    const isExpanded = expandedCategory === category;

    return (
      <div className="bg-dark-200 border border-midnight rounded-xl overflow-hidden">
        {/* Header - clickable to expand */}
        <button
          onClick={() => setExpandedCategory(isExpanded ? null : category)}
          className="w-full flex items-center justify-between p-4 hover:bg-dark-100 transition"
        >
          <div className="flex items-center gap-3">
            <div className="text-primary-500">{icon}</div>
            <div className="text-left">
              <p className="text-white font-medium">{title}</p>
              <p className="text-sm text-muted">{description}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-cyan-400">{selected?.name || 'Default'}</span>
            <svg 
              className={`w-5 h-5 text-muted transition-transform ${isExpanded ? 'rotate-180' : ''}`}
              fill="none" 
              viewBox="0 0 24 24" 
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </button>

        {/* Expanded options */}
        {isExpanded && (
          <div className="border-t border-midnight p-2 space-y-1">
            {options.map((option) => {
              const isSelected = selected?.id === option.id;
              const isPlaying = playingId === option.id;
              
              return (
                <div
                  key={option.id}
                  className={`flex items-center justify-between p-3 rounded-lg transition ${
                    isSelected ? 'bg-primary-500/20 border border-primary-500/50' : 'hover:bg-dark-100'
                  }`}
                >
                  <button
                    onClick={() => handleSelectRingtone(category, option.id)}
                    className="flex items-center gap-3 flex-1"
                  >
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                      isSelected ? 'border-primary-500 bg-primary-500' : 'border-muted'
                    }`}>
                      {isSelected && <Check size={12} className="text-white" />}
                    </div>
                    <span className={`${isSelected ? 'text-white font-medium' : 'text-secondary'}`}>
                      {option.name}
                    </span>
                  </button>
                  
                  <button
                    onClick={() => handlePreview(option.id)}
                    className={`p-2 rounded-lg transition ${
                      isPlaying 
                        ? 'bg-primary-500 text-white' 
                        : 'bg-dark-100 text-secondary hover:text-white hover:bg-midnight'
                    }`}
                  >
                    {isPlaying ? <Square size={16} /> : <Play size={16} />}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <p className="text-secondary text-sm mb-4">
        Customize sounds for calls and messages
      </p>

      {/* Incoming Call Ringtone */}
      {renderRingtoneSelector(
        'incoming',
        <Phone className="w-5 h-5" />,
        'Incoming Call',
        'Sound when someone calls you'
      )}

      {/* Outgoing Call Tone */}
      {renderRingtoneSelector(
        'outgoing',
        <PhoneOutgoing className="w-5 h-5" />,
        'Outgoing Call',
        'Sound while waiting for answer'
      )}

      {/* Message Notification */}
      {renderRingtoneSelector(
        'message',
        <MessageSquare className="w-5 h-5" />,
        'Message',
        'Sound for new messages'
      )}

      {/* Volume Controls */}
      <div className="bg-dark-200 border border-midnight rounded-xl p-4 space-y-4">
        <h4 className="text-white font-medium flex items-center gap-2">
          <Volume2 className="w-5 h-5 text-primary-500" />
          Volume Settings
        </h4>

        {/* Call Volume */}
        <div>
          <label className="text-sm text-secondary mb-2 block">
            Call Volume: {Math.round(settings.callVolume * 100)}%
          </label>
          <div className="flex items-center gap-3">
            <VolumeX className="w-4 h-4 text-muted" />
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={settings.callVolume}
              onChange={handleCallVolumeChange}
              className="flex-1 h-2 bg-dark-100 rounded-lg appearance-none cursor-pointer accent-primary-500"
            />
            <Volume2 className="w-4 h-4 text-muted" />
          </div>
        </div>

        {/* Message Volume */}
        <div>
          <label className="text-sm text-secondary mb-2 block">
            Message Volume: {Math.round(settings.messageVolume * 100)}%
          </label>
          <div className="flex items-center gap-3">
            <VolumeX className="w-4 h-4 text-muted" />
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={settings.messageVolume}
              onChange={handleMessageVolumeChange}
              className="flex-1 h-2 bg-dark-100 rounded-lg appearance-none cursor-pointer accent-primary-500"
            />
            <Volume2 className="w-4 h-4 text-muted" />
          </div>
        </div>
      </div>

      {/* Info */}
      <p className="text-xs text-muted text-center">
        💡 Tap play to preview a sound before selecting it
      </p>
    </div>
  );
}
