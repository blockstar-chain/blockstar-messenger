// BlockStar Cypher - Complete Type Definitions

export interface User {
  walletAddress: string;
  username: string; // @name from NFT
  publicKey: string;
  avatar?: string;
  status?: 'online' | 'offline' | 'away';
  lastSeen?: number;
  bio?: string;
  pushToken?: string; // For push notifications
}

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  recipientId: string | string[]; // Support group chats
  content: string; // encrypted
  timestamp: number;
  delivered: boolean;
  read: boolean;
  type: 'text' | 'image' | 'file' | 'voice' | 'audio' | 'video' | 'location';
  
  // File metadata
  fileName?: string;
  fileSize?: number;
  fileType?: string;
  fileUrl?: string; // IPFS hash
  thumbnailUrl?: string;
  
  // Voice message
  duration?: number;
  waveform?: number[];
  
  // Reactions
  reactions?: MessageReaction[];
  
  // Reply/thread
  replyToId?: string;
  
  // Forwarded
  forwardedFrom?: string;
  
  // Deleted/edited
  deleted?: boolean;
  edited?: boolean;
  editedAt?: number;
}

export interface MessageReaction {
  emoji: string;
  userId: string;
  timestamp: number;
}

export interface Conversation {
  id: string;
  type: 'direct' | 'group';
  participants: string[]; // wallet addresses
  name?: string; // Conversation name for display
  lastMessage?: Message;
  unreadCount: number;
  createdAt: number;
  updatedAt: number;
  
  // Group chat specific
  groupName?: string;
  groupAvatar?: string;
  groupDescription?: string;
  admins?: string[];
  createdBy?: string;
  
  // Pinned/archived
  pinned?: boolean;
  archived?: boolean;
  muted?: boolean;
}

export interface GroupChat extends Conversation {
  type: 'group';
  groupName: string;
  groupAvatar?: string;
  groupDescription?: string;
  admins: string[];
  createdBy: string;
  maxMembers?: number;
  inviteLink?: string;
}

export interface Call {
  id: string;
  callerId: string;
  recipientId: string | string[]; // Single address or array for group calls
  recipientAddress?: string; // Optional backwards compatibility
  type: 'audio' | 'video';
  status: 'calling' | 'ringing' | 'active' | 'ended' | 'missed';
  startTime: number;
  endTime?: number;
  localStream?: MediaStream;
  remoteStream?: MediaStream;
  // Group call properties
  isGroupCall?: boolean;
  participants?: string[]; // All participants including caller
  connectedPeers?: string[]; // Peers that have connected
  groupName?: string; // Group name for display
}

export interface GroupCallParticipant {
  address: string;
  username?: string;
  avatar?: string;
  stream?: MediaStream;
  isConnected: boolean;
  isMuted: boolean;
  isVideoOff: boolean;
}

export interface SignalKeys {
  identityKeyPair: {
    pubKey: Uint8Array;
    privKey: Uint8Array;
  };
  registrationId: number;
  preKeys: Array<{
    keyId: number;
    keyPair: {
      pubKey: Uint8Array;
      privKey: Uint8Array;
    };
  }>;
  signedPreKey: {
    keyId: number;
    keyPair: {
      pubKey: Uint8Array;
      privKey: Uint8Array;
    };
    signature: Uint8Array;
  };
}

export interface NFTMetadata {
  name: string; // @username
  tokenId: string;
  owner: string;
  contractAddress: string;
}

export interface WebRTCConnection {
  peer: any;
  stream?: MediaStream;
  callId: string;
}

export interface FileUpload {
  id: string;
  file: File;
  progress: number;
  status: 'pending' | 'uploading' | 'completed' | 'failed';
  ipfsHash?: string;
  error?: string;
}

export interface VoiceMessage {
  id: string;
  blob: Blob;
  duration: number;
  waveform: number[];
  url?: string;
}

export interface PushNotification {
  title: string;
  body: string;
  icon?: string;
  data?: any;
  tag?: string;
}

export interface IPFSNode {
  hash: string;
  size: number;
  url: string;
}

export interface MeshPeer {
  id: string;
  address: string;
  publicKey: string;
  distance: number; // hop count
  lastSeen: number;
  available: boolean;
}

export interface ZKProof {
  proof: string;
  publicSignals: string[];
  verificationKey: string;
}

export interface CrossChainBridge {
  sourceChain: string;
  targetChain: string;
  bridgeContract: string;
  supported: boolean;
}

export interface SearchResult {
  type: 'message' | 'user' | 'group';
  item: Message | User | GroupChat;
  highlights?: string[];
  score: number;
}

// DHT Types
export interface DHTNode {
  id: string;
  address: string;
  publicKey: string;
  lastSeen: number;
}

export interface DHTEntry {
  key: string;
  value: any;
  timestamp: number;
  ttl: number;
}

// Mobile Mesh Types
export interface BluetoothPeer {
  id: string;
  name: string;
  rssi: number;
  connected: boolean;
}

export interface WiFiDirectPeer {
  deviceName: string;
  deviceAddress: string;
  primaryDeviceType: string;
  status: 'available' | 'invited' | 'connected' | 'failed' | 'unavailable';
}
