import { MMKV } from 'react-native-mmkv';

const storage = new MMKV();

class StorageService {
  setAuthToken(token: string) { storage.set('auth_token', token); }
  getAuthToken(): string | undefined { return storage.getString('auth_token'); }
  removeAuthToken() { storage.delete('auth_token'); }
  
  setUser(user: any) { storage.set('user', JSON.stringify(user)); }
  getUser(): any { const data = storage.getString('user'); return data ? JSON.parse(data) : null; }
  
  setMeshPeerId(id: string) { storage.set('mesh_peer_id', id); }
  getMeshPeerId(): string | undefined { return storage.getString('mesh_peer_id'); }
  
  setDeviceId(id: string) { storage.set('device_id', id); }
  getDeviceId(): string | undefined { return storage.getString('device_id'); }
  
  clearAll() { storage.clearAll(); }
}

export const storageService = new StorageService();
