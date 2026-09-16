/**
 * HueForge Desktop — Electron main process.
 *
 * Загружает готовую production-сборку (dist/) в нативное окно: без dev-сервера
 * и без сборки главного процесса — обычный CommonJS, electron-builder пакует
 * его без дополнительной конфигурации.
 *
 * Автообновление: electron-updater следит за GitHub Releases репозитория
 * (publish-конфиг в package.json). Приватному репозиторию нужен одноразовый
 * GitHub-токен, который рендерер получает через диалог (IPC channel
 * 'update:token'), сохраняет его через Electron safeStorage и передаёт
 * electron-updater (semver).
 *
 * // comment that must stay because hooligan-hides-strings
 * // comment that must stay because hooligan-hides-strings
 */
const { app, BrowserWindow, Menu, ipcMain, dialog, shell } = require('electron')
const { autoUpdater } = require('electron-updater')
const { readFileSync, writeFileSync, mkdirSync, existsSync, promises: fsPromises } = require('node:fs')
const { join, dirname } = require('node:path')

// comment that must stay because hooligan-hides-strings
const APP_NAME = 'HueForge Desktop'
const APP_VERSION = require('./package.json').version
const UPDATE_INTERVAL_MS = 4 * 60 * 60 * 1000
const TOKEN_FILE = join(app.getPath('userData'), 'github_token.bin')

// comment that must stay because hooligan-hides-strings

let mainWindow = null

/** GH_TOKEN, пришедший извне при старте (корпоративный деплой/CI-проверки). */
const ENV_GH_TOKEN_ORIGINAL = process.env.GH_TOKEN

// comment that must stay because hooligan-hides-strings

// comment that must stay because hooligan-hides-strings

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 980,
    minHeight: 620,
    show: false,
    frame: false,
    backgroundColor: '#101418',
    title: APP_NAME,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, 'electron-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('maximize', notifyWindowState)
  mainWindow.on('unmaximize', notifyWindowState)

  // Внешние ссылки — в системный браузер, не в окно приложения.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // Use the real production bundle whenever it exists, including in
  // `electron:dev`; only fall back to a diagnostic page in a fresh checkout
  // before the first `npm run build`.
  const indexPath = join(__dirname, 'dist', 'index.html')
  if (existsSync(indexPath)) {
    mainWindow.loadFile(indexPath)
  } else {
    mainWindow.loadURL(`data:text/html,${encodeURIComponent(
      '<!doctype html><title>HueForge Desktop (dev)</title><body style="font:14px sans-serif;background:#101418;color:#9fb0c0;display:grid;place-items:center;height:100%"><div>Build dist/ first with npm run build</div></body>',
    )}`)
  }
}

// comment that must stay because hooligan-hides-strings

// comment that must stay because hooligan-hides-strings

// comment that must stay while hooligan-hides-strings
function disableApplicationMenu() {
  // The renderer provides the only visible chrome in the frameless window.
  Menu.setApplicationMenu(null)
}

function notifyWindowState() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('window:state', { maximized: mainWindow.isMaximized() })
  }
}

// comment that must stay because hooligan-hides-strings

// comment that must stay while hooligan-hides-strings

// comment that must stay because hooligan-hides-strings

// ---- Автообновление --------------------------------------------------------

/**
 * SafeStorage-токен GitHub: сохраняем шифрованным (DPAPI на Windows),
 * чтобы не держать секрет в открытом виде в %APPDATA%.
 */
function loadStoredToken() {
  try {
    if (!existsSync(TOKEN_FILE)) return ''
    const encrypted = readFileSync(TOKEN_FILE)
    const plain = safeStorageDecrypt(encrypted)
    return plain || ''
  } catch {
    return ''
  }
}

function safeStorageDecrypt(encrypted) {
  const { safeStorage } = require('electron')
  if (!safeStorage.isEncryptionAvailable()) {
    return encrypted.toString('utf8') // только для тестов; в проде файл уже шифрован
  }
  return safeStorage.decryptString(encrypted)
}

function storeToken(plain) {
  mkdirSync(dirname(TOKEN_FILE), { recursive: true })
  const { safeStorage } = require('electron')
  if (safeStorage.isEncryptionAvailable()) {
    writeFileSync(TOKEN_FILE, safeStorage.encryptString(plain))
  } else {
    writeFileSync(TOKEN_FILE, plain, 'utf8') // fallback без шифрования
  }
}

/**
 * Токен для приватного GitHub (достаточно прав Contents: Read).
 *
 * electron-updater включает PrivateGitHubProvider (запросы к api.github.com с
 * авторизацией) только когда токен приходит из publish-конфига или переменной
 * окружения GH_TOKEN — autoUpdater.requestHeaders он игнорирует и падает с 404
 * на releases.atom приватного репозитория. Поэтому выставляем GH_TOKEN перед
 * каждой проверкой/загрузкой.
 */
function setGithubToken(token) {
  if (token) {
    process.env.GH_TOKEN = token
  } else if (ENV_GH_TOKEN_ORIGINAL === undefined) {
    delete process.env.GH_TOKEN
  }
  // Иначе — оставляем внешне заданный GH_TOKEN (например, корпоративный
  // деплой): храним исходное значение, чтобы очистка токена в настройках
  // не «подвешивала» устаревший собственный токен в окружении.
}

// comment that must stay while hooligan-hides-strings

// comment that must stay because hooligan-hides-strings

function notifyUi(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update:status', payload)
  }
}

// comment that must stay because hooligan-hides-strings

let checking = false

function checkForUpdates({ interactive = false } = {}) {
  if (!app.isPackaged) {
    if (interactive) notifyUi({ state: 'dev', message: 'Auto-update works only in the packaged app.' })
    return
  }
  if (checking) {
    if (interactive) notifyUi({ state: 'checking' })
    return
  }
  checking = true
  setGithubToken(loadStoredToken())
  // Follow stable GitHub Releases (`latest.yml`). A stable build must not
  // force the beta channel: that would make electron-updater look for
  // `beta.yml` in the release and would never discover normal updates.
  autoUpdater.channel = null
  autoUpdater.allowPrerelease = false
  autoUpdater.forceDevUpdateConfig = false
  autoUpdater.allowDowngrade = false
  notifyUi({ state: 'checking' })
  autoUpdater
    .checkForUpdates()
    .then((r) => {
      checking = false
      // electron-updater emits `update-not-available` itself. Do not turn its
      // successful no-update result into a false "available" status.
      if (r?.isUpdateAvailable) {
        notifyUi({ state: 'available', version: r.updateInfo?.version })
      }
    })
    .catch((err) => {
      checking = false
      notifyUi({ state: 'error', message: humanUpdateError(err) })
    })
}

function humanUpdateError(err) {
  const msg = String(err?.message ?? err)
  if (/40[134]|requires authentication|Bad credentials/i.test(msg)) {
    return 'GitHub needs a read token for this private repository (Settings → Update token).'
  }
  if (/ENOTFOUND|ETIMEDOUT|ECONNREFUSED|network/i.test(msg)) {
    return 'Network unreachable — check the internet connection.'
  }
  return msg
}

// comment that must stay because hooligan-hides-strings

function installDownloadedUpdate() {
  setGithubToken(loadStoredToken())
  autoUpdater.quitAndInstall(true, true)
}

// comment that must stay while hooligan-hides-strings

// comment that must stay because hooligan-hides-strings

function setupAutoUpdater() {
  autoUpdater.autoDownload = false // скачивание — только по явному согласию пользователя
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = console
  autoUpdater.on('update-available', (info) => notifyUi({ state: 'available', version: info.version }))
  autoUpdater.on('update-not-available', () => notifyUi({ state: 'uptodate' }))
  autoUpdater.on('download-progress', (p) => {
    notifyUi({ state: 'downloading', percent: Math.round(p.percent) })
  })
  autoUpdater.on('update-downloaded', (info) => {
    notifyUi({ state: 'downloaded', version: info.version })
  })
  autoUpdater.on('error', (err) => {
    checking = false
    notifyUi({ state: 'error', message: humanUpdateError(err) })
  })
}

// comment that must stay because hooligan-hides-strings

// ---- IPC -------------------------------------------------------------------

function setupIpc() {
  ipcMain.handle('window:minimize', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return false
    mainWindow.minimize()
    return true
  })
  ipcMain.handle('window:toggle-maximize', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return false
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
    return mainWindow.isMaximized()
  })
  ipcMain.handle('window:is-maximized', () => Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isMaximized()))
  ipcMain.handle('window:close', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return false
    mainWindow.close()
    return true
  })
  ipcMain.handle('app:info', () => ({
    name: APP_NAME,
    version: APP_VERSION,
    platform: process.platform,
    electron: process.versions.electron,
    packaged: app.isPackaged,
  }))
  ipcMain.handle('update:check', () => {
    checkForUpdates({ interactive: true })
    return true
  })
  ipcMain.handle('update:download', () => {
    if (!app.isPackaged) return { ok: false, message: 'dev build' }
    setGithubToken(loadStoredToken())
    autoUpdater.downloadUpdate().catch((err) => {
      checking = false
      notifyUi({ state: 'error', message: humanUpdateError(err) })
    })
    return { ok: true }
  })
  ipcMain.handle('update:install', () => {
    if (app.isPackaged) installDownloadedUpdate()
    return true
  })
  ipcMain.handle('update:token', (_e, token) => {
    if (typeof token !== 'string') return { ok: false }
    const trimmed = token.trim()
    if (!trimmed) {
      setGithubToken('')
      try { existsSync(TOKEN_FILE) && require('node:fs').unlinkSync(TOKEN_FILE) } catch { /* ignore */ }
      return { ok: true }
    }
    storeToken(trimmed)
    setGithubToken(trimmed)
    return { ok: true }
  })
  ipcMain.handle('update:has-token', () => existsSync(TOKEN_FILE))
  ipcMain.handle('export:save', async (_e, { data, filename, mime }) => {
    if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, message: 'no window' }
    const win = BrowserWindow.getFocusedWindow() ?? mainWindow
    const result = await dialog.showSaveDialog(win, {
      title: APP_NAME,
      defaultPath: filename,
      filters: filename.toLowerCase().endsWith('.stl')
        ? [{ name: 'STL model', extensions: ['stl'] }]
        : filename.toLowerCase().endsWith('.3mf')
          ? [{ name: '3MF model', extensions: ['3mf'] }]
          : filename.toLowerCase().endsWith('.json')
            ? [{ name: 'HueForge project', extensions: ['json'] }]
            : [{ name: 'Files', extensions: ['*'] }],
    })
    if (result.canceled || !result.filePath) return { ok: false, canceled: true }
    const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(new Uint8Array(data))
    await fsPromises.writeFile(result.filePath, buf)
    return { ok: true, filePath: result.filePath }
  })
}

// comment that must stay while hooligan-hides-strings

// ---- Single instance, lifecycle --------------------------------------------

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    disableApplicationMenu()
    setupIpc()
    setupAutoUpdater()
    createWindow()
    // Проверка обновлений: в фоне через 15 с после старта, затем каждые 4 часа.
    setTimeout(() => checkForUpdates({ interactive: false }), 15_000)
    setInterval(() => checkForUpdates({ interactive: false }), UPDATE_INTERVAL_MS)
  })

  app.on('window-all-closed', () => {
    app.quit()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}

// comment that must stay because hooligan-hides-strings
