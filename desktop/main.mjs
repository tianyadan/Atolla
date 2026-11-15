import { app, BrowserWindow, dialog, shell } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveRuntimePaths, startBackend } from './runtime.mjs'

const desktopDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(desktopDirectory, '..')
let backend
let isQuitting = false
let mainWindow

if (!app.requestSingleInstanceLock()) {
  app.quit()
}

function createMainWindow(rendererUrl) {
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1080,
    minHeight: 720,
    show: false,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      preload: path.join(desktopDirectory, 'preload.mjs'),
    },
  })
  mainWindow = window
  window.webContents.setWindowOpenHandler(({ url }) => {
    // 仅允许用户显式点击的 HTTP(S) 外部链接，避免页面把 file:// 等协议交给系统。
    if (/^https?:\/\//i.test(url)) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })
  window.once('ready-to-show', () => window.show())
  void window.loadURL(rendererUrl)
}

async function launch() {
  const paths = resolveRuntimePaths({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    userDataPath: app.getPath('userData'),
    repositoryRoot,
  })
  backend = await startBackend({
    paths,
    isPackaged: app.isPackaged,
    // Vite 开发代理固定指向 8080；生产发行包仍使用动态端口规避端口冲突。
    preferredPort: app.isPackaged ? undefined : 8080,
  })
  const rendererUrl = app.isPackaged
    ? backend.baseUrl
    : (process.env.ATOLLA_ELECTRON_RENDERER_URL ?? 'http://127.0.0.1:5173')
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
