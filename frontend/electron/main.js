// electron/main.js
// Main process for Electron desktop app

const { app, BrowserWindow, shell, ipcMain, Notification, protocol } = require('electron');
const path = require('path');
const url = require('url');
const fs = require('fs');

// Keep a global reference to prevent garbage collection
let mainWindow;

// Determine if we're in development mode
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

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
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// ═══════════════════════════════════════════════════════════════
// IPC HANDLERS (for communication with renderer process)
// ═══════════════════════════════════════════════════════════════

// Show native notification
ipcMain.handle('show-notification', async (event, { title, body }) => {
  if (Notification.isSupported()) {
    const notification = new Notification({
      title,
      body,
      icon: path.join(__dirname, '../public/icon.png'),
    });
    notification.show();
    return true;
  }
  return false;
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