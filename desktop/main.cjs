const { app, BrowserWindow, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const net = require('net');

const BACKEND_PORT = Number(process.env.CLEARVOICE_BACKEND_PORT || 8000);
const FRONTEND_DEV_URL = process.env.CLEARVOICE_FRONTEND_URL || 'http://127.0.0.1:5173';
const isDev = !app.isPackaged;
let backendProcess = null;
let mainWindow = null;

function projectRoot() {
  return isDev ? path.resolve(__dirname, '..') : process.resourcesPath;
}

function backendDir() {
  return path.join(projectRoot(), 'backend');
}

function frontendDistDir() {
  return path.join(projectRoot(), 'frontend', 'dist');
}

function pythonExecutable() {
  const backend = backendDir();
  const venvPython = process.platform === 'win32'
    ? path.join(backend, '.venv', 'Scripts', 'python.exe')
    : path.join(backend, '.venv', 'bin', 'python');
  if (fs.existsSync(venvPython)) {
    return venvPython;
  }
  return process.platform === 'win32' ? 'python' : 'python3';
}

function waitForPort(port, host = '127.0.0.1', timeoutMs = 45000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const socket = net.createConnection({ port, host });
      socket.once('connect', () => {
        socket.destroy();
        resolve();
      });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() - started > timeoutMs) {
          reject(new Error(`Backend did not start on ${host}:${port}`));
          return;
        }
        setTimeout(check, 700);
      });
    };
    check();
  });
}

function startBackend() {
  if (process.env.CLEARVOICE_EXTERNAL_BACKEND === '1') {
    return Promise.resolve();
  }
  return waitForPort(BACKEND_PORT, '127.0.0.1', 1200)
    .then(() => {
      console.log(`Reusing existing backend on 127.0.0.1:${BACKEND_PORT}`);
    })
    .catch(() => startBackendProcess());
}

function startBackendProcess() {
  const backend = backendDir();
  const python = pythonExecutable();
  const env = {
    ...process.env,
    PYTHONUNBUFFERED: '1',
    KMP_DUPLICATE_LIB_OK: 'TRUE',
    CLEARVOICE_DESKTOP: '1'
  };
  backendProcess = spawn(
    python,
    ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', String(BACKEND_PORT)],
    { cwd: backend, env, windowsHide: true }
  );
  backendProcess.stdout.on('data', (chunk) => console.log(`[backend] ${chunk}`));
  backendProcess.stderr.on('data', (chunk) => console.error(`[backend] ${chunk}`));
  backendProcess.on('exit', (code) => console.log(`Backend exited with code ${code}`));
  return waitForPort(BACKEND_PORT);
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    title: 'ClearVoice',
    backgroundColor: '#edf3fb',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('did-fail-load', (_event, code, description, url) => {
    console.error(`Window failed to load ${url}: ${code} ${description}`);
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error(`Renderer process gone: ${details.reason}`);
  });

  if (isDev && process.env.CLEARVOICE_USE_VITE_DEV === '1') {
    await mainWindow.loadURL(FRONTEND_DEV_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
    return;
  }

  const indexHtml = path.join(frontendDistDir(), 'index.html');
  if (!fs.existsSync(indexHtml)) {
    dialog.showErrorBox('ClearVoice frontend not built', 'frontend/dist/index.html not found. Run npm --prefix frontend run build first.');
    app.quit();
    return;
  }
  await mainWindow.loadFile(indexHtml);
}

app.whenReady().then(async () => {
  try {
    await startBackend();
    await createWindow();
  } catch (error) {
    dialog.showErrorBox('ClearVoice failed to start', String(error && error.message ? error.message : error));
    app.quit();
  }
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', () => {
  if (backendProcess && !backendProcess.killed) {
    backendProcess.kill();
  }
});
