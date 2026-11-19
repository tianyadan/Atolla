#!/usr/bin/env node
/**
 * Electron 开发运行器：加载 Vite（HMR），并在主进程相关文件变更时自动 relaunch。
 *
 * 用法（通常由 scripts/dev-electron.sh 调用）：
 *   node scripts/dev-runner.mjs
 *   node scripts/dev-runner.mjs --watch-go
 */
import { spawn } from 'node:child_process'
import { existsSync, watch } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveRuntimePaths, startBackend } from '../runtime.mjs'
import { createDevBackendManager } from './dev-backend.mjs'

const desktopDirectory = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const repositoryRoot = path.resolve(desktopDirectory, '..')
const electronBin = path.join(desktopDirectory, 'node_modules', '.bin', 'electron')
const rendererUrl = process.env.ATOLLA_ELECTRON_RENDERER_URL ?? 'http://127.0.0.1:5173'

const watchGo = process.argv.includes('--watch-go')
const openDevtools = process.env.ATOLLA_ELECTRON_OPEN_DEVTOOLS !== '0'

let child = null
let stopping = false
let relaunchTimer = null
let backendRestartTimer = null
let exitRequested = false
let lifecycle = Promise.resolve()

function log(message) {
  console.log(`[electron-dev] ${message}`)
}

function warn(message) {
  console.warn(`[electron-dev] ${message}`)
}

function sendToElectron(current, message) {
  if (current !== child || !current.connected || exitRequested) return
  try {
    current.send(message)
  } catch (error) {
    // 热重启窗口时 IPC 断开是正常竞态，下次启动会重新请求后端地址。
    warn(`Electron IPC 已断开：${error.message}`)
  }
}

const backendManager = createDevBackendManager({
  start: (userDataPath) => startBackend({
    paths: resolveRuntimePaths({ isPackaged: false, resourcesPath: '', userDataPath, repositoryRoot }),
    isPackaged: false,
    preferredPort: 8080,
    detached: true,
    onOutput: (chunk) => process.stdout.write(chunk),
  }),
})

function enqueue(action) {
  const next = lifecycle.then(action)
  lifecycle = next.catch((error) => warn(error.message))
  return next
}

/** 只结束窗口进程，Go 由当前 dev-runner 独立持有。 */
async function stopElectron() {
  if (!child) return
  const current = child
  child = null
  stopping = true
  await new Promise((resolve) => {
    const forceTimer = setTimeout(() => {
      try {
        current.kill('SIGKILL')
      } catch {
        /* ignore */
      }
      resolve()
    }, 4_000)
    current.once('exit', () => {
      clearTimeout(forceTimer)
      resolve()
    })
    try {
      current.kill('SIGTERM')
    } catch {
      clearTimeout(forceTimer)
      resolve()
    }
  })
  stopping = false
}

/** 启动 Electron；渲染进程指向 Vite。 */
function startElectron() {
  if (!existsSync(electronBin)) {
    throw new Error(`找不到 electron：${electronBin}（请先在 desktop/ 执行 npm ci）`)
  }
  log(`启动 Electron → ${rendererUrl}`)
  child = spawn(electronBin, ['.'], {
    cwd: desktopDirectory,
    env: {
      ...process.env,
      ATOLLA_ELECTRON_RENDERER_URL: rendererUrl,
      ATOLLA_ELECTRON_OPEN_DEVTOOLS: openDevtools ? '1' : '0',
      ATOLLA_DEV_RUNNER: '1',
    },
    stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
  })
  const current = child
  current.on('message', (message) => {
    if (current !== child || exitRequested) return
    if (message?.type === 'atolla:dev-start') {
      void enqueue(() => backendManager.ensure(message.userDataPath)).then(
        (backend) => sendToElectron(current, { type: 'atolla:dev-ready', baseUrl: backend.baseUrl }),
        (error) => sendToElectron(current, { type: 'atolla:dev-error', error: error.message }),
      )
    } else if (message?.type === 'atolla:dev-restart') {
      void enqueue(() => backendManager.restart()).then(
        (backend) => sendToElectron(current, { type: 'atolla:dev-restarted', baseUrl: backend.baseUrl }),
        (error) => sendToElectron(current, { type: 'atolla:dev-error', error: error.message }),
      )
    }
  })
  child.on('exit', (code, signal) => {
    child = null
    if (stopping || exitRequested) return
    if (signal) {
      warn(`Electron 退出 signal=${signal}`)
      void shutdown(1)
      return
    }
    // 用户关掉窗口：结束整个开发会话
    log(`Electron 已退出（code=${code ?? 0}），结束开发会话`)
    void shutdown(code ?? 0)
  })
}

/** 防抖后仅重启 Electron；后端进程保持在线。 */
function scheduleRelaunch(reason) {
  if (exitRequested) return
  if (relaunchTimer) clearTimeout(relaunchTimer)
  relaunchTimer = setTimeout(() => {
    void enqueue(async () => {
      log(`检测到变更（${reason}），重启 Electron…`)
      await stopElectron()
      if (exitRequested) return
      startElectron()
    })
  }, 400)
}

function scheduleBackendRestart(reason) {
  if (exitRequested) return
  if (backendRestartTimer) clearTimeout(backendRestartTimer)
  backendRestartTimer = setTimeout(() => {
    void enqueue(async () => {
      log(`检测到变更（${reason}），仅重启 Go 后端…`)
      await backendManager.restart()
    })
  }, 400)
}

/** 监听单个文件；缺失则跳过。 */
function watchFile(filePath, label) {
  if (!existsSync(filePath)) {
    warn(`跳过监听（不存在）：${filePath}`)
    return
  }
  watch(filePath, { persistent: true }, (eventType) => {
    if (eventType === 'rename' || eventType === 'change') {
      scheduleRelaunch(label)
    }
  })
  log(`监听 ${path.relative(repositoryRoot, filePath)}`)
}

/** 递归监听目录下的特定后缀（Go 热重启用）。 */
function watchDirectory(dirPath, extensions, label) {
  if (!existsSync(dirPath)) {
    warn(`跳过监听目录（不存在）：${dirPath}`)
    return
  }
  watch(dirPath, { recursive: true, persistent: true }, (_eventType, filename) => {
    if (!filename) return
    const lower = String(filename).toLowerCase()
    if (!extensions.some((ext) => lower.endsWith(ext))) return
    if (lower.includes(`${path.sep}vendor${path.sep}`) || lower.endsWith('_test.go')) return
    scheduleBackendRestart(`${label}:${filename}`)
  })
  log(`监听 ${path.relative(repositoryRoot, dirPath)}/**/*{${extensions.join(',')}}`)
}

async function shutdown(code = 0) {
  if (exitRequested) return
  exitRequested = true
  if (relaunchTimer) clearTimeout(relaunchTimer)
  if (backendRestartTimer) clearTimeout(backendRestartTimer)
  log('正在停止…')
  await lifecycle
  await stopElectron()
  await backendManager.shutdown()
  process.exit(code)
}

process.on('SIGINT', () => {
  void shutdown()
})
process.on('SIGTERM', () => {
  void shutdown()
})

watchFile(path.join(desktopDirectory, 'main.mjs'), 'main.mjs')
watchFile(path.join(desktopDirectory, 'preload.cjs'), 'preload.cjs')
watchFile(path.join(desktopDirectory, 'runtime.mjs'), 'runtime.mjs')
watchFile(path.join(desktopDirectory, 'dev-bridge.mjs'), 'dev-bridge.mjs')
if (watchGo) {
  watchDirectory(path.join(repositoryRoot, 'server'), ['.go'], 'go')
}

startElectron()
log('前端改动走 Vite HMR（无需重启窗口）；主进程/preload 变更会自动 relaunch')
if (watchGo) {
  log('已启用 --watch-go：修改 server/*.go 仅重启 Go，窗口保持打开')
}
