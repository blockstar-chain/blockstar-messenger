/**
 * COMPLETE preload.js for BlockStar Cypher Electron App
 * 
 * This file MUST be used as the preload script in your BrowserWindow.
 * 
 * In your electron/main.js, make sure you have:
 * 
 *   const mainWindow = new BrowserWindow({
 *     // ... other options
 *     webPreferences: {
 *       preload: path.join(__dirname, 'preload.js'),  // <-- THIS IS CRITICAL
 *       contextIsolation: true,
 *       nodeIntegration: false,
 *     },
 *   });
 */

const { contextBridge, ipcRenderer } = require('electron');

console.log('═══════════════════════════════════════════════════════');
console.log('⚡ Electron preload.js loading...');
console.log('═══════════════════════════════════════════════════════');

contextBridge.exposeInMainWorld('electronAPI', {
  // ─── Platform Info ───
  isElectron: true,
  getPlatform: () => ipcRenderer.invoke('get-platform'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  
  // ─── Notifications ───
  showNotification: (title, body) => ipcRenderer.invoke('show-notification', { title, body }),
  
  // ─── Window Controls ───
  minimizeToTray: () => ipcRenderer.send('minimize-to-tray'),
  
  // ─── Deep Links ───
  onDeepLink: (callback) => ipcRenderer.on('deep-link', (event, url) => callback(url)),

  // ═══════════════════════════════════════════════════════════════
  // WALLET BRIDGE - CRITICAL FOR DESKTOP WALLET CONNECTION
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * Open URL in system browser (Chrome, Firefox, etc.)
   * Used to open MetaMask connection page
   */
  walletOpenBrowser: (url) => {
    console.log('[Preload] walletOpenBrowser called:', url);
    return ipcRenderer.invoke('wallet-open-browser', url);
  },
  
  /**
   * Start local callback server on port 47391
   * Used to receive callback from browser after MetaMask connects
   */
  walletStartServer: () => {
    console.log('[Preload] walletStartServer called');
    return ipcRenderer.invoke('wallet-start-server');
  },
  
  /**
   * Stop the callback server
   */
  walletStopServer: () => {
    console.log('[Preload] walletStopServer called');
    return ipcRenderer.invoke('wallet-stop-server');
  },
  
  /**
   * Listen for wallet connection callback
   * Returns cleanup function to remove listener
   */
  onWalletConnected: (callback) => {
    console.log('[Preload] onWalletConnected listener registered');
    const handler = (event, data) => {
      console.log('[Preload] wallet-connected event received:', data);
      callback(data);
    };
    ipcRenderer.on('wallet-connected', handler);
    return () => {
      console.log('[Preload] onWalletConnected listener removed');
      ipcRenderer.removeListener('wallet-connected', handler);
    };
  },
  
  /**
   * Listen for wallet connection cancelled
   * Returns cleanup function to remove listener
   */
  onWalletCancelled: (callback) => {
    console.log('[Preload] onWalletCancelled listener registered');
    const handler = () => {
      console.log('[Preload] wallet-cancelled event received');
      callback();
    };
    ipcRenderer.on('wallet-cancelled', handler);
    return () => {
      console.log('[Preload] onWalletCancelled listener removed');
      ipcRenderer.removeListener('wallet-cancelled', handler);
    };
  },
  
  /**
   * Listen for message signature callback
   * Returns cleanup function to remove listener
   */
  onWalletSigned: (callback) => {
    console.log('[Preload] onWalletSigned listener registered');
    const handler = (event, data) => {
      console.log('[Preload] wallet-signed event received:', data);
      callback(data);
    };
    ipcRenderer.on('wallet-signed', handler);
    return () => {
      console.log('[Preload] onWalletSigned listener removed');
      ipcRenderer.removeListener('wallet-signed', handler);
    };
  },
});

console.log('═══════════════════════════════════════════════════════');
console.log('✅ Electron preload.js loaded successfully!');
console.log('   - window.electronAPI.isElectron = true');
console.log('   - Wallet bridge functions available');
console.log('═══════════════════════════════════════════════════════');
