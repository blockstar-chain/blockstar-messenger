// frontend/src/lib/ringtones.ts
// Ringtone management service for customizable notification sounds

export interface RingtoneOption {
  id: string;
  name: string;
  file: string;
  category: 'incoming' | 'outgoing' | 'message';
}

export interface RingtoneSettings {
  incomingCall: string;  // ID of selected incoming call ringtone
  outgoingCall: string;  // ID of selected outgoing call tone
  messageSound: string;  // ID of selected message notification
  callVolume: number;    // 0-1
  messageVolume: number; // 0-1
}

// Available ringtones
export const RINGTONES: RingtoneOption[] = [
  // Incoming call ringtones
  { id: 'incoming-gentle', name: 'Gentle Ring', file: '/sounds/ringtones/incoming-gentle.mp3', category: 'incoming' },
  { id: 'incoming-classic', name: 'Classic Phone', file: '/sounds/ringtones/incoming-classic.mp3', category: 'incoming' },
  { id: 'incoming-modern', name: 'Modern Pulse', file: '/sounds/ringtones/incoming-modern.mp3', category: 'incoming' },
  { id: 'incoming-chime', name: 'Crystal Chime', file: '/sounds/ringtones/incoming-chime.mp3', category: 'incoming' },
  { id: 'incoming-aurora', name: 'Aurora', file: '/sounds/ringtones/incoming-aurora.mp3', category: 'incoming' },
  
  // Outgoing call tones (ringback tones)
  { id: 'outgoing-standard', name: 'Standard Ring', file: '/sounds/ringtones/outgoing-standard.mp3', category: 'outgoing' },
  { id: 'outgoing-soft', name: 'Soft Pulse', file: '/sounds/ringtones/outgoing-soft.mp3', category: 'outgoing' },
  { id: 'outgoing-digital', name: 'Digital Tone', file: '/sounds/ringtones/outgoing-digital.mp3', category: 'outgoing' },
  
  // Message notification sounds
  { id: 'message-pop', name: 'Pop', file: '/sounds/ringtones/message-pop.mp3', category: 'message' },
  { id: 'message-chime', name: 'Chime', file: '/sounds/ringtones/message-chime.mp3', category: 'message' },
  { id: 'message-ding', name: 'Ding', file: '/sounds/ringtones/message-ding.mp3', category: 'message' },
  { id: 'message-bubble', name: 'Bubble', file: '/sounds/ringtones/message-bubble.mp3', category: 'message' },
  { id: 'message-subtle', name: 'Subtle', file: '/sounds/ringtones/message-subtle.mp3', category: 'message' },
];

const STORAGE_KEY = 'blockstar_ringtone_settings';

const DEFAULT_SETTINGS: RingtoneSettings = {
  incomingCall: 'incoming-gentle',
  outgoingCall: 'outgoing-standard',
  messageSound: 'message-pop',
  callVolume: 0.7,
  messageVolume: 0.5,
};

class RingtoneService {
  private settings: RingtoneSettings;
  private currentAudio: HTMLAudioElement | null = null;
  private previewAudio: HTMLAudioElement | null = null;

  constructor() {
    this.settings = this.loadSettings();
  }

  private loadSettings(): RingtoneSettings {
    if (typeof window === 'undefined') return DEFAULT_SETTINGS;
    
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
      }
    } catch (error) {
      console.error('Failed to load ringtone settings:', error);
    }
    return DEFAULT_SETTINGS;
  }

  private saveSettings(): void {
    if (typeof window === 'undefined') return;
    
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    } catch (error) {
      console.error('Failed to save ringtone settings:', error);
    }
  }

  getSettings(): RingtoneSettings {
    return { ...this.settings };
  }

  updateSettings(updates: Partial<RingtoneSettings>): void {
    this.settings = { ...this.settings, ...updates };
    this.saveSettings();
  }

  getRingtonesByCategory(category: 'incoming' | 'outgoing' | 'message'): RingtoneOption[] {
    return RINGTONES.filter(r => r.category === category);
  }

  getRingtoneById(id: string): RingtoneOption | undefined {
    return RINGTONES.find(r => r.id === id);
  }

  /**
   * Play a preview of a ringtone (stops after a few seconds)
   */
  async previewRingtone(id: string): Promise<void> {
    this.stopPreview();
    
    const ringtone = this.getRingtoneById(id);
    if (!ringtone) return;

    try {
      this.previewAudio = new Audio(ringtone.file);
      
      // Set volume based on category
      if (ringtone.category === 'message') {
        this.previewAudio.volume = this.settings.messageVolume;
      } else {
        this.previewAudio.volume = this.settings.callVolume;
      }

      // Stop after 3 seconds for preview
      setTimeout(() => this.stopPreview(), 3000);
      
      await this.previewAudio.play();
    } catch (error) {
      console.error('Failed to preview ringtone:', error);
    }
  }

  stopPreview(): void {
    if (this.previewAudio) {
      this.previewAudio.pause();
      this.previewAudio.currentTime = 0;
      this.previewAudio = null;
    }
  }

  /**
   * Play incoming call ringtone (loops)
   */
  async playIncomingRingtone(): Promise<HTMLAudioElement | null> {
    this.stopCurrentSound();
    
    const ringtone = this.getRingtoneById(this.settings.incomingCall);
    if (!ringtone) {
      // Fallback to default sound
      this.currentAudio = new Audio('/sounds/ringtone.mp3');
    } else {
      this.currentAudio = new Audio(ringtone.file);
    }
    
    this.currentAudio.loop = true;
    this.currentAudio.volume = this.settings.callVolume;

    try {
      await this.currentAudio.play();
      return this.currentAudio;
    } catch (error) {
      console.error('Failed to play incoming ringtone:', error);
      return null;
    }
  }

  /**
   * Play outgoing call tone (loops)
   */
  async playOutgoingTone(): Promise<HTMLAudioElement | null> {
    this.stopCurrentSound();
    
    const ringtone = this.getRingtoneById(this.settings.outgoingCall);
    if (!ringtone) {
      // Fallback to default sound
      this.currentAudio = new Audio('/sounds/outgoing.mp3');
    } else {
      this.currentAudio = new Audio(ringtone.file);
    }
    
    this.currentAudio.loop = true;
    this.currentAudio.volume = this.settings.callVolume;

    try {
      await this.currentAudio.play();
      return this.currentAudio;
    } catch (error) {
      console.error('Failed to play outgoing tone:', error);
      return null;
    }
  }

  /**
   * Play message notification sound (once)
   */
  async playMessageSound(): Promise<void> {
    const ringtone = this.getRingtoneById(this.settings.messageSound);
    
    const audio = new Audio(ringtone?.file || '/sounds/notification.mp3');
    audio.volume = this.settings.messageVolume;

    try {
      await audio.play();
    } catch (error) {
      console.error('Failed to play message sound:', error);
    }
  }

  /**
   * Stop current playing sound
   */
  stopCurrentSound(): void {
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.currentTime = 0;
      this.currentAudio = null;
    }
  }

  /**
   * Set call volume (0-1)
   */
  setCallVolume(volume: number): void {
    this.settings.callVolume = Math.max(0, Math.min(1, volume));
    this.saveSettings();
    
    if (this.currentAudio) {
      this.currentAudio.volume = this.settings.callVolume;
    }
  }

  /**
   * Set message volume (0-1)
   */
  setMessageVolume(volume: number): void {
    this.settings.messageVolume = Math.max(0, Math.min(1, volume));
    this.saveSettings();
  }
}

export const ringtoneService = new RingtoneService();
export default ringtoneService;
