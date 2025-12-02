import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge Tailwind CSS classes
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Generate conversation ID from wallet addresses
 */
export function generateConversationId(...addresses: (string | undefined | null)[]): string {
  const validAddresses = addresses.filter((a): a is string => typeof a === 'string' && a.length > 0);
  const sorted = validAddresses.map(a => a.toLowerCase()).sort();
  return sorted.join('-');
}

/**
 * Generate unique message ID
 */
export function generateMessageId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Format timestamp to readable format
 */
export function formatTimestamp(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (seconds < 60) {
    return 'Just now';
  } else if (minutes < 60) {
    return `${minutes}m ago`;
  } else if (hours < 24) {
    return `${hours}h ago`;
  } else if (days < 7) {
    return `${days}d ago`;
  } else {
    const date = new Date(timestamp);
    return date.toLocaleDateString();
  }
}

/**
 * Format message time
 */
export function formatMessageTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * Truncate wallet address
 */
export function truncateAddress(address: string | undefined | null): string {
  if (!address || typeof address !== 'string') return '';
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Validate wallet address
 */
export function isValidAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

/**
 * Copy to clipboard
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    console.error('Failed to copy:', error);
    return false;
  }
}

/**
 * Get initials from username
 */
export function getInitials(username: string | undefined | null): string {
  if (!username || typeof username !== 'string') return '??';
  const name = username.replace('@', '');
  return name.slice(0, 2).toUpperCase();
}

/**
 * Generate random color for avatar (theme-consistent)
 */
export function getAvatarColor(address: string | undefined | null): string {
  const colors = [
    'bg-gradient-to-br from-primary-500 to-cyan-500',
    'bg-gradient-to-br from-primary-600 to-primary-400',
    'bg-gradient-to-br from-cyan-500 to-primary-500',
    'bg-gradient-to-br from-success-500 to-cyan-500',
    'bg-gradient-to-br from-primary-500 to-success-500',
    'bg-gradient-to-br from-cyan-600 to-cyan-400',
    'bg-gradient-to-br from-primary-400 to-cyan-600',
    'bg-gradient-to-br from-cyan-400 to-primary-600',
  ];
  
  if (!address || typeof address !== 'string') return colors[0];
  const index = parseInt(address.slice(2, 8), 16) % colors.length;
  return colors[index];
}

/**
 * Download file
 */
export function downloadFile(data: Blob, filename: string): void {
  const url = URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Format file size
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Debounce function
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout;
  
  return function executedFunction(...args: Parameters<T>) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * Throttle function
 */
export function throttle<T extends (...args: any[]) => any>(
  func: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle: boolean;
  
  return function executedFunction(...args: Parameters<T>) {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}
