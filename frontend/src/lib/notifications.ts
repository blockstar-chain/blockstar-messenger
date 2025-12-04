// frontend/src/lib/notifications.ts
// Browser Push Notifications and Sound Service

export interface NotificationSettings {
  enabled: boolean;
  sound: boolean;
  soundVolume: number; // 0-1
  showPreview: boolean; // Show message content in notification
  desktopNotifications: boolean;
  mutedConversations: string[]; // Conversation IDs that are muted
}

const DEFAULT_SETTINGS: NotificationSettings = {
  enabled: true,
  sound: true,
  soundVolume: 0.5,
  showPreview: true,
  desktopNotifications: true,
  mutedConversations: [],
};

const STORAGE_KEY = 'blockstar_notification_settings';

class NotificationService {
  private settings: NotificationSettings;
  private audioContext: AudioContext | null = null;
  private notificationSound: HTMLAudioElement | null = null;
  private isTabFocused: boolean = true;
  private permissionGranted: boolean = false;

  constructor() {
    this.settings = this.loadSettings();
    this.setupVisibilityListener();
    this.initAudio();
    this.checkPermission();
  }

  /**
   * Load settings from localStorage
   */
  private loadSettings(): NotificationSettings {
    if (typeof window === 'undefined') return DEFAULT_SETTINGS;
    
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
      }
    } catch (error) {
      console.warn('Failed to load notification settings:', error);
    }
    return DEFAULT_SETTINGS;
  }

  /**
   * Save settings to localStorage
   */
  private saveSettings(): void {
    if (typeof window === 'undefined') return;
    
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    } catch (error) {
      console.warn('Failed to save notification settings:', error);
    }
  }

  /**
   * Initialize audio for notification sounds
   */
  private initAudio(): void {
    if (typeof window === 'undefined') return;

    // Create audio element for notification sound
    this.notificationSound = new Audio('/sounds/notification.mp3');
    this.notificationSound.volume = this.settings.soundVolume;
    
    // Handle audio loading errors gracefully
    this.notificationSound.onerror = () => {
      console.warn('⚠️ Notification sound file not found, using generated sound');
      this.notificationSound = null;
    };
    
    // Preload the audio
    this.notificationSound.load();
    
    // Initialize AudioContext for fallback/generated sounds
    try {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    } catch (e) {
      console.warn('Web Audio API not supported');
    }
  }

  /**
   * Listen for tab focus/blur to determine when to show notifications
   */
  private setupVisibilityListener(): void {
    if (typeof window === 'undefined') return;

    document.addEventListener('visibilitychange', () => {
      this.isTabFocused = document.visibilityState === 'visible';
    });

    window.addEventListener('focus', () => {
      this.isTabFocused = true;
    });

    window.addEventListener('blur', () => {
      this.isTabFocused = false;
    });
  }

  /**
   * Check if we have notification permission
   */
  private checkPermission(): void {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    
    this.permissionGranted = Notification.permission === 'granted';
  }

  /**
   * Request notification permission from user
   */
  async requestPermission(): Promise<boolean> {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      console.warn('Notifications not supported in this browser');
      return false;
    }

    if (Notification.permission === 'granted') {
      this.permissionGranted = true;
      return true;
    }

    if (Notification.permission === 'denied') {
      console.warn('Notification permission was denied');
      return false;
    }

    try {
      const permission = await Notification.requestPermission();
      this.permissionGranted = permission === 'granted';
      return this.permissionGranted;
    } catch (error) {
      console.error('Error requesting notification permission:', error);
      return false;
    }
  }

  /**
   * Get current permission status
   */
  getPermissionStatus(): 'granted' | 'denied' | 'default' | 'unsupported' {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      return 'unsupported';
    }
    return Notification.permission;
  }

  /**
   * Generate a notification sound using Web Audio API (fallback)
   */
  private playGeneratedSound(): void {
    if (!this.audioContext) return;
    
    try {
      // Resume audio context if suspended (browser autoplay policy)
      if (this.audioContext.state === 'suspended') {
        this.audioContext.resume();
      }
      
      const oscillator = this.audioContext.createOscillator();
      const gainNode = this.audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(this.audioContext.destination);
      
      // Pleasant notification tone (two-tone chime)
      oscillator.frequency.setValueAtTime(880, this.audioContext.currentTime); // A5
      oscillator.frequency.setValueAtTime(1318.5, this.audioContext.currentTime + 0.1); // E6
      
      oscillator.type = 'sine';
      
      // Volume envelope
      const volume = this.settings.soundVolume * 0.3; // Keep it gentle
      gainNode.gain.setValueAtTime(0, this.audioContext.currentTime);
      gainNode.gain.linearRampToValueAtTime(volume, this.audioContext.currentTime + 0.01);
      gainNode.gain.linearRampToValueAtTime(volume * 0.7, this.audioContext.currentTime + 0.1);
      gainNode.gain.linearRampToValueAtTime(0, this.audioContext.currentTime + 0.3);
      
      oscillator.start(this.audioContext.currentTime);
      oscillator.stop(this.audioContext.currentTime + 0.3);
    } catch (error) {
      console.warn('Could not play generated sound:', error);
    }
  }

  /**
   * Play notification sound
   */
  async playSound(): Promise<void> {
    if (!this.settings.enabled || !this.settings.sound) return;
    
    try {
      if (this.notificationSound) {
        this.notificationSound.currentTime = 0;
        this.notificationSound.volume = this.settings.soundVolume;
        await this.notificationSound.play();
      }
    } catch (error) {
      // Audio play might fail, try generated sound as fallback
      console.warn('Could not play notification sound file, using generated sound');
      this.playGeneratedSound();
    }
  }

  /**
   * Show a desktop notification
   */
  showNotification(
    title: string,
    options: {
      body?: string;
      icon?: string;
      tag?: string;
      conversationId?: string;
      onClick?: () => void;
    } = {}
  ): Notification | null {
    console.log('🔔 showNotification called:', { 
      title, 
      enabled: this.settings.enabled,
      desktopNotifications: this.settings.desktopNotifications,
      isTabFocused: this.isTabFocused,
      permissionGranted: this.permissionGranted,
      permission: typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'N/A'
    });
    
    // Don't show if disabled
    if (!this.settings.enabled || !this.settings.desktopNotifications) {
      console.log('🔔 Notifications disabled in settings');
      return null;
    }
    
    // Don't show if tab is focused (user is looking at the app)
    if (this.isTabFocused) {
      console.log('🔔 Tab is focused, skipping popup (sound still plays)');
      return null;
    }
    
    // Check permission
    if (!this.permissionGranted) {
      console.log('🔔 Permission not granted, attempting to request...');
      // Try to request permission (will only work after user interaction)
      this.requestPermission().then(granted => {
        if (granted) {
          // Try showing the notification again
          this.showNotification(title, options);
        }
      });
      return null;
    }

    // Check if conversation is muted
    if (options.conversationId && this.settings.mutedConversations.includes(options.conversationId)) {
      console.log('🔔 Conversation is muted');
      return null;
    }

    try {
      console.log('🔔 Creating notification popup...');
      const notification = new Notification(title, {
        body: this.settings.showPreview ? options.body : 'New message',
        icon: options.icon || '/logo.png',
        tag: options.tag || `blockstar-${Date.now()}`,
        badge: '/logo.png',
        silent: true, // We handle sound ourselves
        requireInteraction: false,
      });

      // Auto close after 5 seconds
      setTimeout(() => notification.close(), 5000);

      // Handle click
      notification.onclick = () => {
        window.focus();
        notification.close();
        if (options.onClick) {
          options.onClick();
        }
      };

      console.log('🔔 Notification created successfully');
      return notification;
    } catch (error) {
      console.error('🔔 Error showing notification:', error);
      return null;
    }
  }

  /**
   * Notify about a new message
   */
  async notifyNewMessage(
    senderName: string,
    messageContent: string,
    options: {
      senderAvatar?: string;
      conversationId?: string;
      isGroup?: boolean;
      groupName?: string;
      onClick?: () => void;
    } = {}
  ): Promise<void> {
    if (!this.settings.enabled) return;

    // Check if conversation is muted
    if (options.conversationId && this.settings.mutedConversations.includes(options.conversationId)) {
      return;
    }

    // Play sound (even if tab is focused, unless muted)
    await this.playSound();

    // Show desktop notification (only if tab not focused)
    const title = options.isGroup && options.groupName 
      ? `${senderName} in ${options.groupName}`
      : senderName;

    this.showNotification(title, {
      body: messageContent,
      icon: options.senderAvatar || '/logo.png',
      tag: `message-${options.conversationId || Date.now()}`,
      conversationId: options.conversationId,
      onClick: options.onClick,
    });
  }

  /**
   * Notify about a call
   */
  async notifyIncomingCall(
    callerName: string,
    options: {
      callerAvatar?: string;
      isVideo?: boolean;
      onClick?: () => void;
    } = {}
  ): Promise<void> {
    if (!this.settings.enabled) return;

    // Always play sound for calls
    await this.playSound();

    const callType = options.isVideo ? 'video' : 'voice';
    
    this.showNotification(`Incoming ${callType} call`, {
      body: `${callerName} is calling you`,
      icon: options.callerAvatar || '/logo.png',
      tag: 'incoming-call',
      onClick: options.onClick,
    });
  }

  /**
   * Get current settings
   */
  getSettings(): NotificationSettings {
    return { ...this.settings };
  }

  /**
   * Update settings
   */
  updateSettings(updates: Partial<NotificationSettings>): void {
    this.settings = { ...this.settings, ...updates };
    
    // Update audio volume if changed
    if (updates.soundVolume !== undefined && this.notificationSound) {
      this.notificationSound.volume = updates.soundVolume;
    }
    
    this.saveSettings();
  }

  /**
   * Mute a conversation
   */
  muteConversation(conversationId: string): void {
    if (!this.settings.mutedConversations.includes(conversationId)) {
      this.settings.mutedConversations.push(conversationId);
      this.saveSettings();
    }
  }

  /**
   * Unmute a conversation
   */
  unmuteConversation(conversationId: string): void {
    this.settings.mutedConversations = this.settings.mutedConversations.filter(
      id => id !== conversationId
    );
    this.saveSettings();
  }

  /**
   * Check if a conversation is muted
   */
  isConversationMuted(conversationId: string): boolean {
    return this.settings.mutedConversations.includes(conversationId);
  }

  /**
   * Toggle notifications globally
   */
  toggleNotifications(enabled: boolean): void {
    this.updateSettings({ enabled });
  }

  /**
   * Toggle sound
   */
  toggleSound(enabled: boolean): void {
    this.updateSettings({ sound: enabled });
  }

  /**
   * Set sound volume (0-1)
   */
  setSoundVolume(volume: number): void {
    this.updateSettings({ soundVolume: Math.max(0, Math.min(1, volume)) });
  }

  /**
   * Test notification (for settings page)
   */
  async testNotification(): Promise<void> {
    await this.playSound();
    
    if (this.permissionGranted) {
      const notification = new Notification('BlockStar Cypher', {
        body: 'Notifications are working! 🎉',
        icon: '/logo.png',
        silent: true,
      });
      setTimeout(() => notification.close(), 3000);
    }
  }
}

// Export singleton instance
export const notificationService = new NotificationService();

export default notificationService;
