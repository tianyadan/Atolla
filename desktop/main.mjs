import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveRuntimePaths, startBackend } from './runtime.mjs'
import { requestDevRunnerBackend, resolveDevRunnerControl } from './dev-bridge.mjs'

const desktopDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(desktopDirectory, '..')
const APP_NAME = 'Atolla'
let backend
let isQuitting = false
let mainWindow
// 开发态 Go 只能由 dev-runner 持有。禁止 Electron IPC 失效后自行拉起 Go，
// 否则主进程热重启会把运行中的 Agent 一并杀掉。
const devRunnerControl = !app.isPackaged ? resolveDevRunnerControl(process.env) : null
const managedByDevRunner = devRunnerControl !== null
if (managedByDevRunner) {
  app.setPath('userData', devRunnerControl.userDataPath)
}

// 尽早改名：菜单栏 / About / 部分系统 UI 不再显示 Electron
app.setName(APP_NAME)
if (process.platform === 'darwin') {
  app.setAboutPanelOptions({
    applicationName: APP_NAME,
    applicationVersion: app.getVersion(),
  })
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
}

/** 配置变更后重启整应用：先停后端再 relaunch，避免仍提示 restart.sh。 */
ipcMain.handle('atolla:relaunch-app', async () => {
  // 稍延迟，让 HTTP 响应先回到渲染进程。
  setTimeout(() => {
    if (managedByDevRunner) {
      // 配置变更必须由 dev-runner 重启 Go；普通窗口热重启不会调用此接口。
      void requestDevRunnerBackend(devRunnerControl, 'restart')
        .then(() => mainWindow?.reload())
        .catch((error) => dialog.showMessageBox({ type: 'error', title: 'Atolla 后端重启失败', message: error.message }))
      return
    }
    const stop = backend?.stop?.() ?? Promise.resolve()
    void stop.finally(() => {
      isQuitting = true
      app.relaunch()
      app.exit(0)
    })
  }, 150)
  return { ok: true }
})

/** Electron 原生 SQLite 文件选择/保存。 */
ipcMain.handle('atolla:pick-sqlite-file', async (_event, mode) => {
  const isSave = mode === 'save'
  try {
    if (isSave) {
      const result = await dialog.showSaveDialog(mainWindow ?? undefined, {
        title: '选择 SQLite 数据库保存位置',
        defaultPath: 'atolla.db',
        filters: [{ name: 'SQLite', extensions: ['db'] }],
      })
      if (result.canceled || !result.filePath) {
        return { cancelled: true }
      }
      let filePath = result.filePath
      if (!filePath.toLowerCase().endsWith('.db')) {
        filePath += '.db'
      }
      return { path: filePath }
    }
    const result = await dialog.showOpenDialog(mainWindow ?? undefined, {
      title: '选择 SQLite 数据库文件',
      properties: ['openFile'],
      filters: [
        { name: 'SQLite', extensions: ['db', 'sqlite'] },
        { name: 'All', extensions: ['*'] },
      ],
    })
    if (result.canceled || !result.filePaths?.[0]) {
      return { cancelled: true }
    }
    return { path: result.filePaths[0] }
  } catch (error) {
    return { error: error?.message || String(error) }
  }
})

/** 开发态 / 未打包时使用品牌图标（打包后由 .app Info.plist / icns 提供）。 */
function resolveAppIconPath() {
  const candidates = [
    path.join(desktopDirectory, 'build', 'icon.png'),
    path.join(desktopDirectory, 'build', 'icon.icns'),
  ]
  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) return candidate
    } catch {
      /* ignore */
    }
  }
  return undefined
}

function createMainWindow(rendererUrl) {
  const iconPath = resolveAppIconPath()
  const window = new BrowserWindow({
    title: APP_NAME,
    width: 1440,
    height: 960,
    minWidth: 1080,
    minHeight: 720,
    show: false,
    // macOS：隐藏原生标题栏与居中标题，保留红黄绿；页面可延伸到顶部
    ...(process.platform === 'darwin'
      ? {
          titleBarStyle: 'hiddenInset',
          // 略靠上；侧栏用 padding-top 把品牌行顶到按钮下方
          trafficLightPosition: { x: 14, y: 14 },
        }
      : {}),
    ...(iconPath ? { icon: iconPath } : {}),
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      preload: path.join(desktopDirectory, 'preload.cjs'),
    },
  })
  mainWindow = window
  // macOS Dock：开发态显式设置，避免仍显示 Electron 默认图标
  if (process.platform === 'darwin' && iconPath && app.dock) {
    app.dock.setIcon(iconPath)
  }
  // 防止页面 <title> 把窗口名改回无关文案
  window.on('page-title-updated', (event) => {
    event.preventDefault()
    window.setTitle(APP_NAME)
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    // 仅允许用户显式点击的 HTTP(S) 外部链接，避免页面把 file:// 等协议交给系统。
    if (/^https?:\/\//i.test(url)) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })
  window.once('ready-to-show', () => {
    window.show()
    // 开发态可选打开 DevTools（scripts/dev-electron.sh 默认开启）
    if (!app.isPackaged && process.env.ATOLLA_ELECTRON_OPEN_DEVTOOLS === '1') {
      window.webContents.openDevTools({ mode: 'detach' })
    }
  })
  void window.loadURL(rendererUrl)
}

async function launch() {
  if (!app.isPackaged && !managedByDevRunner) {
    throw new Error('开发模式必须通过 scripts/dev-electron.sh 或 npm run dev 启动；Go 仅由 dev-runner 持有')
  }
  const paths = resolveRuntimePaths({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    userDataPath: app.getPath('userData'),
    repositoryRoot,
  })
  const devBackendUrl = managedByDevRunner
    ? await requestDevRunnerBackend(devRunnerControl, 'ensure', { userDataPath: paths.applicationDataRoot })
    : null
  if (!managedByDevRunner) {
    backend = await startBackend({
      paths,
      isPackaged: app.isPackaged,
      // 开发：Vite 代理固定 8080；打包：优先 19800 并持久化，避免 origin 变化清空 localStorage。
      preferredPort: app.isPackaged ? 19800 : 8080,
    })
  }
  const rendererUrl = app.isPackaged
    ? backend.baseUrl
    : (process.env.ATOLLA_ELECTRON_RENDERER_URL ?? 'http://127.0.0.1:5173')
  if (managedByDevRunner && devBackendUrl !== 'http://127.0.0.1:8080') {
    throw new Error(`开发后端地址与 Vite 代理不一致：${devBackendUrl}`)
  }
  createMainWindow(rendererUrl)
}

app.whenReady().then(launch).catch(async (error) => {
  await backend?.stop()
  await dialog.showMessageBox({
    type: 'error',
    title: 'Atolla 启动失败',
    message: error.message,
    detail: '请检查 Application Support/Atolla/logs，并确认 Go 后端可执行文件完整。',
  })
  app.exit(1)
})

app.on('second-instance', () => {
  if (!mainWindow) {
    return
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore()
  }
  mainWindow.focus()
})

app.on('before-quit', (event) => {
  if (isQuitting || !backend) {
    return
  }
  event.preventDefault()
  isQuitting = true
  backend.stop().finally(() => app.quit())
})
