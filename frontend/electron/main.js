// electron/main.js
// Main process for Electron desktop app

const { app, BrowserWindow, shell, ipcMain, Notification, protocol } = require('electron');
const path = require('path');
const url = require('url');
const fs = require('fs');
const http = require('http');

// Keep a global reference to prevent garbage collection
let mainWindow;

// Determine if we're in development mode
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
let walletCallbackServer = null;
const WALLET_CALLBACK_PORT = 47391;

// Register custom protocol before app is ready
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true
    }
  }
]);

function createWindow() {
  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: true,
    },
    icon: path.join(__dirname, '../public/icon.png'),
    // macOS specific
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 15, y: 15 },
    // General
    show: false,
    backgroundColor: '#0f172a', // Match your app's dark background
  });

  // Load the app
  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools();
  } else {
    // FIXED: Load production build with proper file protocol
    const indexPath = path.join(__dirname, '../out/index.html');

    // Verify file exists
    if (fs.existsSync(indexPath)) {
      mainWindow.loadURL(url.format({
        pathname: indexPath,
        protocol: 'file:',
        slashes: true
      }));

      // Uncomment below to debug in production
      // mainWindow.webContents.openDevTools();
    } else {
      console.error('❌ index.html not found at:', indexPath);
      console.error('Current directory:', __dirname);
      console.error('Parent directory contents:', fs.readdirSync(path.join(__dirname, '..')));
    }
  }

  // Log loading errors for debugging
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error('❌ Failed to load:', validatedURL);
    console.error('Error:', errorDescription, '(code:', errorCode + ')');
  });

  // Log console messages from renderer (useful for debugging)
  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    const levels = ['verbose', 'info', 'warning', 'error'];
    const prefix = levels[level] === 'error' ? '❌' : 'ℹ️';
    console.log(`${prefix} [Renderer]: ${message}`);
  });

  // Handle external links - open in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url: linkUrl }) => {
    if (linkUrl.startsWith('http://') || linkUrl.startsWith('https://')) {
      shell.openExternal(linkUrl);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();

    // Focus on macOS
    if (process.platform === 'darwin') {
      app.dock.show();
    }
  });

  // Handle window close
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Handle navigation within the app
  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl);

    // Allow localhost and your app's domain
    const allowedOrigins = [
      'http://localhost:3000',
      'https://messenger.blockstar.world',
    ];

    // In production, also allow file:// protocol
    if (!isDev && navigationUrl.startsWith('file://')) {
      return; // Allow file:// navigation in production
    }

    if (!allowedOrigins.some(origin => navigationUrl.startsWith(origin))) {
      event.preventDefault();
      shell.openExternal(navigationUrl);
    }
  });
}

// ═══════════════════════════════════════════════════════════════
// APP LIFECYCLE
// ═══════════════════════════════════════════════════════════════

// This method will be called when Electron has finished initialization
app.whenReady().then(() => {
  createWindow();

  // On macOS, re-create window when dock icon is clicked
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed (except on macOS)
app.on('window-all-closed', () => {
  // Clean up wallet server
  if (walletCallbackServer) {
    walletCallbackServer.close();
    walletCallbackServer = null;
  }
  
  // Your existing quit logic...
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// ═══════════════════════════════════════════════════════════════
// IPC HANDLERS (for communication with renderer process)
// ═══════════════════════════════════════════════════════════════

// Open URL in system browser (ONLY ONCE - no duplicates!)
ipcMain.handle('wallet-open-browser', async (event, url) => {
  console.log('🔗 [Main] Opening browser:', url);
  try {
    await shell.openExternal(url);
    return { success: true };
  } catch (error) {
    console.error('❌ [Main] Failed to open browser:', error);
    return { success: false, error: error.message };
  }
});

// Start local callback server
ipcMain.handle('wallet-start-server', async () => {
  console.log('🔗 [Main] Starting wallet callback server...');
  
  return new Promise((resolve) => {
    // Close existing server if any
    if (walletCallbackServer) {
      try {
        walletCallbackServer.close();
      } catch (e) {}
      walletCallbackServer = null;
    }

    walletCallbackServer = http.createServer((req, res) => {
      // CORS headers
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

      if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }

      const reqUrl = new URL(req.url, `http://localhost:${WALLET_CALLBACK_PORT}`);
      console.log('🔗 [Main] Callback received:', reqUrl.pathname);

      // ─── WALLET CONNECT CALLBACK ───
      if (reqUrl.pathname === '/callback') {
        const address = reqUrl.searchParams.get('address');
        const chainId = reqUrl.searchParams.get('chainId');
        const session = reqUrl.searchParams.get('session');

        console.log('✅ [Main] Wallet connected:', { address, chainId, session });

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('wallet-connected', { address, chainId, session });
          mainWindow.focus();
        }

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<!DOCTYPE html>
<html><head>
<style>
body { font-family: system-ui; display: flex; justify-content: center; align-items: center; 
       height: 100vh; margin: 0; background: linear-gradient(135deg, #0f172a, #1e293b); color: white; }
.container { text-align: center; }
.icon { font-size: 64px; margin-bottom: 16px; }
h1 { margin: 0 0 8px 0; }
p { opacity: 0.7; }
</style>
</head><body>
<div class="container">
  <div class="icon">✓</div>
  <h1>Wallet Connected!</h1>
  <p>Returning to BlockStar Cypher...</p>
</div>
<script>setTimeout(() => window.close(), 1500);</script>
</body></html>`);
        return;
      }

      // ─── MESSAGE SIGN CALLBACK ───
      if (reqUrl.pathname === '/sign-callback') {
        const signId = reqUrl.searchParams.get('signId');
        const signature = reqUrl.searchParams.get('signature');
        const error = reqUrl.searchParams.get('error');

        console.log('✅ [Main] Message signed:', { signId, hasSignature: !!signature });

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('wallet-signed', { signId, signature, error });
          mainWindow.focus();
        }

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<!DOCTYPE html>
<html><head>
<style>
body { font-family: system-ui; display: flex; justify-content: center; align-items: center; 
       height: 100vh; margin: 0; background: linear-gradient(135deg, #0f172a, #1e293b); color: white; }
.container { text-align: center; }
.icon { font-size: 64px; margin-bottom: 16px; }
h1 { margin: 0 0 8px 0; }
p { opacity: 0.7; }
</style>
</head><body>
<div class="container">
  <div class="icon">✓</div>
  <h1>Message Signed!</h1>
  <p>Returning to BlockStar Cypher...</p>
</div>
<script>setTimeout(() => window.close(), 1500);</script>
</body></html>`);
        return;
      }

      // ─── CANCEL CALLBACK ───
      if (reqUrl.pathname === '/cancel') {
        console.log('❌ [Main] Wallet operation cancelled');

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('wallet-cancelled', {});
          mainWindow.focus();
        }

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body><script>window.close()</script></body></html>');
        return;
      }

      // 404 for unknown routes
      res.writeHead(404);
      res.end('Not found');
    });

    walletCallbackServer.listen(WALLET_CALLBACK_PORT, '127.0.0.1', () => {
      console.log(`✅ [Main] Wallet callback server running on port ${WALLET_CALLBACK_PORT}`);
      resolve({ port: WALLET_CALLBACK_PORT });
    });

    walletCallbackServer.on('error', (err) => {
      console.error('❌ [Main] Wallet server error:', err);
      
      // If port is in use, try to use it anyway (might be from previous instance)
      if (err.code === 'EADDRINUSE') {
        console.log('🔄 [Main] Port in use, assuming existing server');
        resolve({ port: WALLET_CALLBACK_PORT });
      } else {
        resolve({ port: null, error: err.message });
      }
    });
  });
});

// Stop callback server
ipcMain.handle('wallet-stop-server', async () => {
  console.log('🔗 [Main] Stopping wallet callback server...');
  
  if (walletCallbackServer) {
    try {
      walletCallbackServer.close();
      walletCallbackServer = null;
      console.log('✅ [Main] Wallet callback server stopped');
    } catch (e) {
      console.error('❌ [Main] Error stopping server:', e);
    }
  }
  
  return { success: true };
});


// Get app version
ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

// Get platform info
ipcMain.handle('get-platform', () => {
  return {
    platform: process.platform,
    arch: process.arch,
    version: process.getSystemVersion(),
  };
});

// Minimize to tray (optional)
ipcMain.on('minimize-to-tray', () => {
  if (mainWindow) {
    mainWindow.hide();
  }
});

// ═══════════════════════════════════════════════════════════════
// DEEP LINKS (for handling cypher:// protocol)
// ═══════════════════════════════════════════════════════════════

// Register protocol handler (optional)
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('cypher', process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient('cypher');
}

// Handle protocol on macOS
app.on('open-url', (event, url) => {
  event.preventDefault();
  if (mainWindow) {
    mainWindow.webContents.send('deep-link', url);
    mainWindow.focus();
  }
});

// Handle protocol on Windows/Linux (single instance)
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine) => {
    // Someone tried to run a second instance
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();

      // Check for deep link in command line
      const deepLink = commandLine.find(arg => arg.startsWith('cypher://'));
      if (deepLink) {
        mainWindow.webContents.send('deep-link', deepLink);
      }
    }
  });
}
