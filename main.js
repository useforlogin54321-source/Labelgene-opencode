const { app, BrowserWindow, shell, ipcMain, session } = require('electron');
const path = require('path');

let mainWindow;

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
      allowRunningInsecureContent: true,
      preload: path.join(__dirname, 'preload.js')
    },
    title: 'LabelGene',
    icon: path.join(__dirname, 'icon-192.png'),
    show: false,
    titleBarStyle: 'default'
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Handle external links
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Clear service worker data only (don't touch local_storage — it holds user presets)
  const ses = mainWindow.webContents.session;
  await ses.clearStorageData({ storages: ['serviceworkers', 'cache_storage', 'caches'] });
  await ses.clearCache();

  // Log console messages to main process
  mainWindow.webContents.on('console-message', (event, level, message) => {
    console.log('[RENDERER]', message);
  });

  // Load the LabelGene web app
  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // Test localStorage persistence after page loads
  mainWindow.webContents.on('did-finish-load', async () => {
    await mainWindow.webContents.executeJavaScript(`
      try {
        // Test localStorage
        localStorage.setItem('_test_key', 'hello');
        const val = localStorage.getItem('_test_key');
        console.log('localStorage test:', val === 'hello' ? 'PASS' : 'FAIL (' + val + ')');
        localStorage.removeItem('_test_key');

        // Test prompt
        console.log('prompt() available:', typeof prompt === 'function');
      } catch(e) {
        console.log('Test ERROR:', e.message);
      }
    `);
  });
}

// ─── IPC: List available printers ───────────────────────────────────────────
ipcMain.handle('get-printers', async () => {
  try {
    const printers = await mainWindow.webContents.getPrintersAsync();
    return printers.map(p => ({
      name: p.name,
      displayName: p.displayName || p.name,
      description: p.description || '',
      isDefault: p.isDefault,
      status: p.status,
    }));
  } catch (err) {
    console.error('get-printers failed:', err);
    return [];
  }
});

// ─── IPC: Print PDF buffer directly to a printer (silent, no OS dialog) ────
ipcMain.handle('silent-print', async (event, { pdfBase64, printerName, copies }) => {
  return new Promise((resolve, reject) => {
    try {
      const pdfBuffer = Buffer.from(pdfBase64, 'base64');

      const printWin = new BrowserWindow({
        show: false,
        webPreferences: {
          offscreen: true,
          nodeIntegration: false,
          contextIsolation: true,
        }
      });

      printWin.loadURL('data:application/pdf;base64,' + pdfBase64);

      printWin.webContents.on('did-finish-load', () => {
        setTimeout(() => {
          const options = {
            silent: true,
            deviceName: printerName || '',
            copies: copies || 1,
            printBackground: true,
          };

          printWin.webContents.print(options, (success, failureReason) => {
            printWin.close();
            if (success) {
              resolve({ success: true });
            } else {
              resolve({ success: false, error: failureReason });
            }
          });
        }, 500);
      });

      printWin.webContents.on('did-fail-load', (e, code, desc) => {
        printWin.close();
        resolve({ success: false, error: `Load failed: ${code} ${desc}` });
      });

    } catch (err) {
      resolve({ success: false, error: err.message || String(err) });
    }
  });
});

// ─── IPC: Open system print dialog (fallback) ──────────────────────────────
ipcMain.handle('system-print', async (event, { pdfBase64 }) => {
  return new Promise((resolve) => {
    try {
      const printWin = new BrowserWindow({
        show: false,
        webPreferences: { offscreen: true, nodeIntegration: false, contextIsolation: true }
      });
      printWin.loadURL('data:application/pdf;base64,' + pdfBase64);
      printWin.webContents.on('did-finish-load', () => {
        setTimeout(() => {
          printWin.webContents.print({}, (success, reason) => {
            printWin.close();
            resolve({ success, error: reason });
          });
        }, 500);
      });
    } catch (err) {
      resolve({ success: false, error: err.message });
    }
  });
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Security: Prevent new window creation
app.on('web-contents-created', (event, contents) => {
  contents.on('new-window', (event, navigationUrl) => {
    event.preventDefault();
    shell.openExternal(navigationUrl);
  });
});
