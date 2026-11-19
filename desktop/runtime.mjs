import { spawn as defaultSpawn } from 'node:child_process'
import { existsSync, createWriteStream, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { createServer } from 'node:net'
import path from 'node:path'

const HEALTH_TIMEOUT_MS = 20_000
const HEALTH_INTERVAL_MS = 250
/** 打包态默认回环端口；持久化后保证 localStorage origin 稳定，避免每次都进引导页。 */
const PACKAGED_DEFAULT_PORT = 19800

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

/** 读取已保存的桌面后端端口（用于稳定 http://127.0.0.1:port origin）。 */
export function readSavedDesktopPort(configDir) {
  const filePath = path.join(configDir, 'desktop-http-port')
  try {
    const raw = readFileSync(filePath, 'utf8').trim()
    const port = Number(raw)
    if (Number.isInteger(port) && port >= 1024 && port <= 65535) return port
  } catch {
    /* missing / unreadable */
  }
  return 0
}

/** 持久化桌面后端端口。 */
export function writeSavedDesktopPort(configDir, port) {
  writeFileSync(path.join(configDir, 'desktop-http-port'), String(port), 'utf8')
}

/**
 * 解析启动端口：开发态固定 preferred；打包态优先沿用已保存端口，保持 localStorage。
 * 若占用则改分配并回写。
 */
export async function resolveDesktopListenPort({ configDir, preferredPort = 0, packagedDefaultPort = PACKAGED_DEFAULT_PORT, strictPreferred = false }) {
  // 开发态 Vite 固定代理 preferredPort；绝不能换随机端口却让页面继续请求旧端口。
  if (strictPreferred && preferredPort > 0) {
    try {
      return await allocateLoopbackPort(preferredPort)
    } catch {
      throw new Error(`开发后端端口 ${preferredPort} 被占用，请先检查占用进程或其它 Atolla 实例`)
    }
  }
  const saved = readSavedDesktopPort(configDir)
  const candidates = []
  if (preferredPort > 0) candidates.push(preferredPort)
  if (saved > 0 && saved !== preferredPort) candidates.push(saved)
  if (!preferredPort && packagedDefaultPort > 0) candidates.push(packagedDefaultPort)

  for (const candidate of candidates) {
    try {
      const port = await allocateLoopbackPort(candidate)
      if (port !== saved) writeSavedDesktopPort(configDir, port)
      return port
    } catch {
      /* try next */
    }
  }
  const port = await allocateLoopbackPort(0)
  writeSavedDesktopPort(configDir, port)
  return port
}

/** 解析简单 KEY=VALUE .env（忽略注释；不处理复杂导出语法）。 */
export function readEnvFile(filePath) {
  const out = {}
  let raw = ''
  try {
    raw = readFileSync(filePath, 'utf8')
  } catch {
    return out
  }
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const body = trimmed.startsWith('export ') ? trimmed.slice(7).trim() : trimmed
    const eq = body.indexOf('=')
    if (eq <= 0) continue
    const key = body.slice(0, eq).trim()
    let value = body.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

/**
 * 解析桌面端应使用的 DB 驱动与 DSN。
 * 优先已保存的 .env / 继承环境，避免每次启动覆盖用户指定的 SQLite 路径。
 */
export function resolveDesktopDatabaseConfig({ inheritedEnvironment, isPackaged, paths }) {
  const envFilePath = path.join(
    isPackaged ? paths.applicationDataRoot : path.dirname(paths.serverDirectory ?? ''),
    '.env',
  )
  const saved = readEnvFile(envFilePath)
  const driver =
    saved.AVATAR_DB_DRIVER ||
    inheritedEnvironment.AVATAR_DB_DRIVER ||
    'sqlite'
  const dsn =
    saved.AVATAR_DB_DSN ||
    inheritedEnvironment.AVATAR_DB_DSN ||
    paths.databasePath
  return { driver, dsn, envFilePath }
}

export function buildBackendEnvironment({ inheritedEnvironment, isPackaged, paths, port }) {
  const backendUrl = `http://127.0.0.1:${port}`
  const homeDirectory = inheritedEnvironment.HOME || homedir()
  const nvmDirectory = inheritedEnvironment.NVM_DIR || path.join(homeDirectory, '.nvm')
  const { driver, dsn } = resolveDesktopDatabaseConfig({ inheritedEnvironment, isPackaged, paths })
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
    // 告知后端：由桌面壳托管，数据库/运行时变更应返回 desktop relaunch，勿调 restart.sh。
    AVATAR_DESKTOP: '1',
    AVATAR_DB_DRIVER: driver,
    AVATAR_DB_DSN: dsn,
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

function stopChild(child, timeoutMs = 5_000, detached = false) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve()
      return
    }
    // go run 会再派生实际服务进程；独立进程组才能一并结束，避免 8080 残留。
    const signal = (name) => {
      if (detached && child.pid && process.platform !== 'win32') {
        try { process.kill(-child.pid, name); return true } catch { /* 已退出 */ }
      }
      return child.kill(name)
    }
    const forceTimer = setTimeout(() => signal('SIGKILL'), timeoutMs)
    child.once('exit', () => {
      clearTimeout(forceTimer)
      resolve()
    })
    if (!signal('SIGTERM')) {
      clearTimeout(forceTimer)
      resolve()
    }
  })
}

export async function startBackend({ paths, isPackaged, preferredPort, inheritedEnvironment = process.env, spawnImpl = defaultSpawn, fetchImpl = fetch, detached = false, onOutput }) {
  await ensureRuntimeDirectories(paths)
  const port = await resolveDesktopListenPort({
    configDir: paths.configDir,
    preferredPort: preferredPort || 0,
    strictPreferred: !isPackaged,
  })
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
    ...(detached ? { detached: true } : {}),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout?.pipe(backendLog, { end: false })
  child.stderr?.pipe(backendLog, { end: false })
  if (onOutput) {
    child.stdout?.on('data', onOutput)
    child.stderr?.on('data', onOutput)
  }

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
    await stopChild(child, 5_000, detached)
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
