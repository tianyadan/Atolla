import { spawn as defaultSpawn } from 'node:child_process'
import { existsSync, createWriteStream, readdirSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { createServer } from 'node:net'
import path from 'node:path'

const HEALTH_TIMEOUT_MS = 20_000
const HEALTH_INTERVAL_MS = 250

export function resolveRuntimePaths({ isPackaged, resourcesPath, userDataPath, repositoryRoot }) {
  const runtimeRoot = path.join(userDataPath, 'runtime')
  return {
    applicationDataRoot: userDataPath,
    dataDir: path.join(userDataPath, 'data'),
    logDir: path.join(userDataPath, 'logs'),
    configDir: path.join(userDataPath, 'config'),
    databasePath: path.join(userDataPath, 'data', 'atolla.db'),
    serverExecutable: isPackaged
      ? path.join(resourcesPath, 'bin', 'atolla-server')
      : 'go',
    serverDirectory: isPackaged
      ? undefined
      : path.join(repositoryRoot, 'server'),
    webDir: isPackaged
      ? path.join(resourcesPath, 'web')
      : path.join(repositoryRoot, 'web', 'dist'),
    runtimeRoot,
  }
}

export async function ensureRuntimeDirectories(paths) {
  await Promise.all([paths.dataDir, paths.logDir, paths.configDir].map((directory) => mkdir(directory, { recursive: true })))
}

function discoverNvmNodeBinDirectories(nvmDirectory) {
  const versionsDirectory = path.join(nvmDirectory, 'versions', 'node')
  try {
    return readdirSync(versionsDirectory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(versionsDirectory, entry.name, 'bin'))
      .filter((directory) => existsSync(directory))
      .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }))
  } catch {
    return []
  }
}

/**
 * Finder 启动的 macOS 应用只有系统 PATH；CLI 常安装在 NVM、Homebrew 或用户目录。
 * 保留原 PATH，并只补充常见、可预测的命令目录，避免执行 shell 配置文件的副作用。
 */
export function buildDesktopCommandPath({ existingPath, homeDirectory, nvmBinDirectories = [] }) {
  const directories = [
    ...nvmBinDirectories,
    path.join(homeDirectory, '.local', 'bin'),
    path.join(homeDirectory, '.bun', 'bin'),
    path.join(homeDirectory, '.cargo', 'bin'),
    path.join(homeDirectory, 'go', 'bin'),
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/local/bin',
    ...(existingPath ?? '').split(path.delimiter),
  ]
  return [...new Set(directories.filter(Boolean))].join(path.delimiter)
}

export function allocateLoopbackPort(preferredPort = 0) {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen({ host: '127.0.0.1', port: preferredPort }, () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('无法分配本机后端端口')))
        return
      }
      server.close((error) => error ? reject(error) : resolve(address.port))
    })
  })
}

export function buildBackendEnvironment({ inheritedEnvironment, isPackaged, paths, port }) {
  const backendUrl = `http://127.0.0.1:${port}`
  const homeDirectory = inheritedEnvironment.HOME || homedir()
  const nvmDirectory = inheritedEnvironment.NVM_DIR || path.join(homeDirectory, '.nvm')
  const environment = {
    ...inheritedEnvironment,
    PATH: buildDesktopCommandPath({
      existingPath: inheritedEnvironment.PATH,
      homeDirectory,
      nvmBinDirectories: discoverNvmNodeBinDirectories(nvmDirectory),
    }),
    AVATAR_ADDR: `127.0.0.1:${port}`,
    AVATAR_BACKEND_URL: backendUrl,
    AVATAR_ALLOWED_IPS: '127.0.0.1,::1',
    AVATAR_DB_DRIVER: 'sqlite',
    AVATAR_DB_DSN: paths.databasePath,
    AVATAR_LOG_DIR: paths.logDir,
    AVATAR_WEB_DIR: paths.webDir ?? '',
  }
  if (isPackaged) {
    environment.AVATAR_RUNTIME_ROOT = paths.applicationDataRoot
  }
  return environment
}

async function waitForHealth(baseUrl, fetchImpl, timeoutMs = HEALTH_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    try {
      const response = await fetchImpl(`${baseUrl}/health`, { signal: AbortSignal.timeout(1_000) })
      if (response.ok) {
        return
      }
      lastError = new Error(`健康检查返回 HTTP ${response.status}`)
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, HEALTH_INTERVAL_MS))
  }
  throw new Error(`Atolla 后端启动超时：${lastError?.message ?? '未知错误'}`)
}

function stopChild(child, timeoutMs = 5_000) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve()
      return
    }
    const forceTimer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
    child.once('exit', () => {
      clearTimeout(forceTimer)
      resolve()
    })
    if (!child.kill('SIGTERM')) {
      clearTimeout(forceTimer)
      resolve()
    }
  })
}

export async function startBackend({ paths, isPackaged, preferredPort, inheritedEnvironment = process.env, spawnImpl = defaultSpawn, fetchImpl = fetch }) {
  await ensureRuntimeDirectories(paths)
  const port = await allocateLoopbackPort(preferredPort)
  const baseUrl = `http://127.0.0.1:${port}`
  const backendLog = createWriteStream(path.join(paths.logDir, 'backend.log'), { flags: 'a' })
  // WriteStream opens asynchronously. Passing it directly to spawn() races with that open
  // and Electron rejects it while fd is still null, so child output is piped after spawning.
  backendLog.on('error', (error) => {
    console.error(`无法写入 Atolla 后端日志：${error.message}`)
  })
  backendLog.write(`\n[desktop] starting backend at ${new Date().toISOString()}\n`)
  const child = spawnImpl(paths.serverExecutable, isPackaged ? [] : ['run', '.'], {
    cwd: paths.serverDirectory,
    env: buildBackendEnvironment({ inheritedEnvironment, isPackaged, paths, port }),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout?.pipe(backendLog, { end: false })
  child.stderr?.pipe(backendLog, { end: false })

  const childFailure = new Promise((_, reject) => {
    child.once('error', (error) => reject(new Error(`无法启动 Atolla 后端：${error.message}`)))
    child.once('exit', (code, signal) => reject(new Error(`Atolla 后端在健康检查前退出（code=${code ?? 'null'}, signal=${signal ?? 'null'}）`)))
  })
  let stopped = false
  const stop = async () => {
    if (stopped) {
      return
    }
    stopped = true
    await stopChild(child)
    backendLog.end(`[desktop] backend stopped at ${new Date().toISOString()}\n`)
  }
  try {
    await Promise.race([waitForHealth(baseUrl, fetchImpl), childFailure])
  } catch (error) {
    await stop()
    throw error
  }
  return { baseUrl, child, stop }
}
