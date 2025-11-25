/**
 * DHT (Distributed Hash Table) Service
 * Decentralized key-value storage and user discovery
 * Based on Kademlia algorithm
 */

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
  signature: string;
}

export class DHTService {
  private localNode: DHTNode | null = null;
  private kBuckets: Map<number, DHTNode[]> = new Map();
  private storage: Map<string, DHTEntry> = new Map();
  private k: number = 20; // Bucket size
  private alpha: number = 3; // Parallel requests
  private keySize: number = 160; // bits

  /**
   * Initialize DHT node
   */
  async initialize(walletAddress: string, publicKey: string): Promise<void> {
    this.localNode = {
      id: await this.generateNodeId(walletAddress),
      address: walletAddress,
      publicKey,
      lastSeen: Date.now(),
    };

    // Initialize k-buckets
    for (let i = 0; i < this.keySize; i++) {
      this.kBuckets.set(i, []);
    }

    console.log('DHT initialized:', this.localNode.id);
  }

  /**
   * Generate node ID from wallet address
   */
  private async generateNodeId(address: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(address);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Store key-value pair in DHT
   */
  async store(key: string, value: any, sign: boolean = true): Promise<void> {
    const hashedKey = await this.hashKey(key);
    
    const entry: DHTEntry = {
      key: hashedKey,
      value,
      timestamp: Date.now(),
      signature: sign ? await this.signData(value) : '',
    };

    this.storage.set(hashedKey, entry);

    // Find closest nodes and replicate
    const closestNodes = await this.findClosestNodes(hashedKey);
    await this.replicateToNodes(entry, closestNodes);
  }

  /**
   * Retrieve value from DHT
   */
  async retrieve(key: string): Promise<any | null> {
    const hashedKey = await this.hashKey(key);

    // Check local storage first
    const localEntry = this.storage.get(hashedKey);
    if (localEntry) {
      return localEntry.value;
    }

    // Query network
    const closestNodes = await this.findClosestNodes(hashedKey);
    
    for (const node of closestNodes) {
      const value = await this.queryNode(node, hashedKey);
      if (value) {
        // Cache locally
        this.storage.set(hashedKey, {
          key: hashedKey,
          value,
          timestamp: Date.now(),
          signature: '',
        });
        return value;
      }
    }

    return null;
  }

  /**
   * Find user's public key
   */
  async findUser(walletAddress: string): Promise<string | null> {
    const key = `user:${walletAddress}:publicKey`;
    return await this.retrieve(key);
  }

  /**
   * Publish user's public key
   */
  async publishUserKey(walletAddress: string, publicKey: string): Promise<void> {
    const key = `user:${walletAddress}:publicKey`;
    await this.store(key, publicKey);
  }

  /**
   * Find @name to address mapping
   */
  async findUsername(username: string): Promise<string | null> {
    const key = `username:${username}`;
    return await this.retrieve(key);
  }

  /**
   * Publish @name to address mapping
   */
  async publishUsername(username: string, address: string): Promise<void> {
    const key = `username:${username}`;
    await this.store(key, address);
  }

  /**
   * Find closest nodes to a key
   */
  private async findClosestNodes(key: string): Promise<DHTNode[]> {
    const keyNum = BigInt('0x' + key);
    const localIdNum = BigInt('0x' + this.localNode!.id);
    const distance = keyNum ^ localIdNum;

    // Get bucket index
    const bucketIndex = this.getBucketIndex(distance);

    // Collect candidates from nearby buckets
    const candidates: DHTNode[] = [];
    
    for (let i = bucketIndex; i >= 0 && candidates.length < this.k; i--) {
      const bucket = this.kBuckets.get(i) || [];
      candidates.push(...bucket);
    }

    for (let i = bucketIndex + 1; i < this.keySize && candidates.length < this.k; i++) {
      const bucket = this.kBuckets.get(i) || [];
      candidates.push(...bucket);
    }

    // Sort by XOR distance
    candidates.sort((a, b) => {
      const distA = BigInt('0x' + a.id) ^ keyNum;
      const distB = BigInt('0x' + b.id) ^ keyNum;
      return distA < distB ? -1 : 1;
    });

    return candidates.slice(0, this.k);
  }

  /**
   * Add node to routing table
   */
  addNode(node: DHTNode): void {
    if (!this.localNode || node.id === this.localNode.id) {
      return;
    }

    const distance = BigInt('0x' + node.id) ^ BigInt('0x' + this.localNode.id);
    const bucketIndex = this.getBucketIndex(distance);
    const bucket = this.kBuckets.get(bucketIndex) || [];

    // Check if node already exists
    const existingIndex = bucket.findIndex((n) => n.id === node.id);
    
    if (existingIndex !== -1) {
      // Update last seen
      bucket[existingIndex].lastSeen = Date.now();
    } else if (bucket.length < this.k) {
      // Add to bucket
      bucket.push(node);
      this.kBuckets.set(bucketIndex, bucket);
    } else {
      // Bucket full, ping least recently seen
      this.evictLeastRecentlySeenNode(bucketIndex, node);
    }
  }

  /**
   * Get bucket index from XOR distance
   */
  private getBucketIndex(distance: bigint): number {
    if (distance === 0n) return 0;
    
    let index = 0;
    let d = distance;
    
    while (d > 1n) {
      d = d >> 1n;
      index++;
    }
    
    return Math.min(index, this.keySize - 1);
  }

  /**
   * Evict least recently seen node
   */
  private async evictLeastRecentlySeenNode(
    bucketIndex: number,
    newNode: DHTNode
  ): Promise<void> {
    const bucket = this.kBuckets.get(bucketIndex) || [];
    
    // Find least recently seen
    let leastRecentIndex = 0;
    let leastRecentTime = bucket[0].lastSeen;
    
    for (let i = 1; i < bucket.length; i++) {
      if (bucket[i].lastSeen < leastRecentTime) {
        leastRecentIndex = i;
        leastRecentTime = bucket[i].lastSeen;
      }
    }

    // Ping least recent node
    const isAlive = await this.pingNode(bucket[leastRecentIndex]);
    
    if (!isAlive) {
      // Replace with new node
      bucket[leastRecentIndex] = newNode;
      this.kBuckets.set(bucketIndex, bucket);
    }
  }

  /**
   * Hash key
   */
  private async hashKey(key: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(key);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Sign data
   */
  private async signData(data: any): Promise<string> {
    // Use wallet signature
    return ''; // Implement with wallet signing
  }

  /**
   * Replicate entry to nodes
   */
  private async replicateToNodes(
    entry: DHTEntry,
    nodes: DHTNode[]
  ): Promise<void> {
    // Send store requests to nodes
    // Implementation depends on network layer
  }

  /**
   * Query node for value
   */
  private async queryNode(node: DHTNode, key: string): Promise<any | null> {
    // Send query request to node
    // Implementation depends on network layer
    return null;
  }

  /**
   * Ping node to check if alive
   */
  private async pingNode(node: DHTNode): Promise<boolean> {
    // Send ping request
    // Implementation depends on network layer
    return true;
  }

  /**
   * Get DHT statistics
   */
  getStats(): {
    localNodeId: string;
    storedEntries: number;
    knownNodes: number;
    buckets: number;
  } {
    let totalNodes = 0;
    this.kBuckets.forEach((bucket) => {
      totalNodes += bucket.length;
    });

    return {
      localNodeId: this.localNode?.id || '',
      storedEntries: this.storage.size,
      knownNodes: totalNodes,
      buckets: this.kBuckets.size,
    };
  }

  /**
   * Cleanup old entries
   */
  cleanup(): void {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours

    this.storage.forEach((entry, key) => {
      if (now - entry.timestamp > maxAge) {
        this.storage.delete(key);
      }
    });
  }
}

export const dhtService = new DHTService();
