import { create, IPFSHTTPClient } from 'ipfs-http-client';
import { FileUpload, IPFSNode } from '@/types';

/**
 * IPFS Service for Decentralized File Storage
 * Handles file uploads, downloads, and pinning
 */

export class IPFSService {
  private client: IPFSHTTPClient | null = null;
  private gateway: string = 'https://ipfs.io/ipfs/';
  private uploadCallbacks: Map<string, (progress: number) => void> = new Map();

  constructor() {
    this.initialize();
  }

  /**
   * Initialize IPFS client
   */
  private async initialize(): Promise<void> {
    try {
      // Connect to IPFS node (use public gateway or your own node)
      this.client = create({
        host: 'ipfs.infura.io',
        port: 5001,
        protocol: 'https',
        headers: {
          // Add Infura project credentials if using Infura
          // authorization: 'Basic ' + btoa('projectId:projectSecret'),
        },
      });

      console.log('IPFS client initialized');
    } catch (error) {
      console.error('Failed to initialize IPFS:', error);
    }
  }

  /**
   * Upload file to IPFS
   */
  async uploadFile(
    file: File,
    onProgress?: (progress: number) => void
  ): Promise<IPFSNode> {
    if (!this.client) {
      throw new Error('IPFS client not initialized');
    }

    try {
      const fileBuffer = await file.arrayBuffer();
      const uint8Array = new Uint8Array(fileBuffer);

      // Upload to IPFS with progress tracking
      let uploadedBytes = 0;
      const totalBytes = uint8Array.length;

      const result = await this.client.add(
        {
          path: file.name,
          content: uint8Array,
        },
        {
          progress: (bytes) => {
            uploadedBytes += bytes;
            const progress = (uploadedBytes / totalBytes) * 100;
            if (onProgress) {
              onProgress(Math.min(progress, 100));
            }
          },
        }
      );

      // Pin the file to ensure persistence
      await this.client.pin.add(result.cid);

      return {
        hash: result.cid.toString(),
        size: result.size,
        url: `${this.gateway}${result.cid.toString()}`,
      };
    } catch (error) {
      console.error('IPFS upload error:', error);
      throw new Error('Failed to upload file to IPFS');
    }
  }

  /**
   * Upload multiple files
   */
  async uploadFiles(
    files: File[],
    onProgress?: (fileIndex: number, progress: number) => void
  ): Promise<IPFSNode[]> {
    const results: IPFSNode[] = [];

    for (let i = 0; i < files.length; i++) {
      const result = await this.uploadFile(files[i], (progress) => {
        if (onProgress) {
          onProgress(i, progress);
        }
      });
      results.push(result);
    }

    return results;
  }

  /**
   * Get file from IPFS
   */
  async getFile(hash: string): Promise<Blob> {
    if (!this.client) {
      throw new Error('IPFS client not initialized');
    }

    try {
      const chunks: Uint8Array[] = [];

      for await (const chunk of this.client.cat(hash)) {
        chunks.push(chunk);
      }

      const combined = new Uint8Array(
        chunks.reduce((acc, chunk) => acc + chunk.length, 0)
      );
      let offset = 0;

      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }

      return new Blob([combined]);
    } catch (error) {
      console.error('IPFS get error:', error);
      throw new Error('Failed to retrieve file from IPFS');
    }
  }

  /**
   * Get file URL
   */
  getFileUrl(hash: string): string {
    return `${this.gateway}${hash}`;
  }

  /**
   * Pin file (ensure persistence)
   */
  async pinFile(hash: string): Promise<void> {
    if (!this.client) {
      throw new Error('IPFS client not initialized');
    }

    try {
      await this.client.pin.add(hash);
    } catch (error) {
      console.error('IPFS pin error:', error);
    }
  }

  /**
   * Unpin file
   */
  async unpinFile(hash: string): Promise<void> {
    if (!this.client) {
      throw new Error('IPFS client not initialized');
    }

    try {
      await this.client.pin.rm(hash);
    } catch (error) {
      console.error('IPFS unpin error:', error);
    }
  }

  /**
   * Get file stats
   */
  async getFileStats(hash: string): Promise<{ size: number }> {
    if (!this.client) {
      throw new Error('IPFS client not initialized');
    }

    try {
      const stats = await this.client.files.stat(`/ipfs/${hash}`);
      return { size: stats.size };
    } catch (error) {
      console.error('IPFS stats error:', error);
      throw new Error('Failed to get file stats');
    }
  }

  /**
   * Upload image with thumbnail generation
   */
  async uploadImage(
    file: File,
    generateThumbnail: boolean = true
  ): Promise<{ original: IPFSNode; thumbnail?: IPFSNode }> {
    const original = await this.uploadFile(file);

    if (generateThumbnail) {
      const thumbnail = await this.createThumbnail(file);
      const thumbnailNode = await this.uploadFile(thumbnail);
      return { original, thumbnail: thumbnailNode };
    }

    return { original };
  }

  /**
   * Create thumbnail from image
   */
  private async createThumbnail(file: File): Promise<File> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d')!;

          // Thumbnail size
          const maxSize = 200;
          let width = img.width;
          let height = img.height;

          if (width > height) {
            if (width > maxSize) {
              height *= maxSize / width;
              width = maxSize;
            }
          } else {
            if (height > maxSize) {
              width *= maxSize / height;
              height = maxSize;
            }
          }

          canvas.width = width;
          canvas.height = height;
          ctx.drawImage(img, 0, 0, width, height);

          canvas.toBlob(
            (blob) => {
              if (blob) {
                const thumbnailFile = new File([blob], `thumb_${file.name}`, {
                  type: 'image/jpeg',
                });
                resolve(thumbnailFile);
              } else {
                reject(new Error('Failed to create thumbnail'));
              }
            },
            'image/jpeg',
            0.7
          );
        };
        img.src = e.target?.result as string;
      };

      reader.readAsDataURL(file);
    });
  }

  /**
   * Check if file exists in IPFS
   */
  async fileExists(hash: string): Promise<boolean> {
    try {
      await this.getFileStats(hash);
      return true;
    } catch {
      return false;
    }
  }
}

export const ipfsService = new IPFSService();
