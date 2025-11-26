import * as nacl from 'tweetnacl';
import * as naclUtil from 'tweetnacl-util';

class EncryptionService {
  private keyPair: nacl.BoxKeyPair | null = null;
  
  async initialize(seed: string): Promise<void> {
    const seedBytes = naclUtil.decodeUTF8(seed).slice(0, 32);
    this.keyPair = nacl.box.keyPair.fromSecretKey(new Uint8Array(seedBytes));
  }
  
  getPublicKey(): string {
    return this.keyPair ? naclUtil.encodeBase64(this.keyPair.publicKey) : '';
  }
}

export const encryptionService = new EncryptionService();
