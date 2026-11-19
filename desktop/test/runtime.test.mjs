import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import path from 'node:path'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { PassThrough } from 'node:stream'
import vm from 'node:vm'
import { createServer } from 'node:net'
import { buildBackendEnvironment, buildDesktopCommandPath, ensureRuntimeDirectories, resolveDesktopDatabaseConfig, resolveDesktopListenPort, readSavedDesktopPort, resolveRuntimePaths, startBackend } from '../runtime.mjs'

test('packaged runtime uses application resources and Application Support data', async () => {
  const userDataPath = await mkdtemp(path.join(tmpdir(), 'atolla-runtime-'))
  const paths = resolveRuntimePaths({
    isPackaged: true,
    resourcesPath: '/Applications/Atolla.app/Contents/Resources',
    userDataPath,
    repositoryRoot: '/workspace/Atolla',
  })
  assert.equal(paths.serverExecutable, '/Applications/Atolla.app/Contents/Resources/bin/atolla-server')
  assert.equal(paths.webDir, '/Applications/Atolla.app/Contents/Resources/web')
  const environment = buildBackendEnvironment({
    inheritedEnvironment: { HOME: '/Users/example', PATH: '/usr/bin:/bin' },
    isPackaged: true,
    paths,
    port: 18080,
  })
  assert.equal(environment.AVATAR_RUNTIME_ROOT, userDataPath)
  assert.equal(environment.AVATAR_DESKTOP, '1')
  await ensureRuntimeDirectories(paths)
  await writeFile(paths.databasePath, 'existing-data')
  await ensureRuntimeDirectories(paths)
  assert.equal(await readFile(paths.databasePath, 'utf8'), 'existing-data')
})

test('development runtime starts Go from the repository server directory', () => {
  const paths = resolveRuntimePaths({
    isPackaged: false,
    resourcesPath: '/ignored',
    userDataPath: '/Users/example/Library/Application Support/Atolla',
    repositoryRoot: '/workspace/Atolla',
  })
  assert.equal(paths.serverExecutable, 'go')
  assert.equal(paths.serverDirectory, '/workspace/Atolla/server')
  assert.equal(paths.webDir, '/workspace/Atolla/web/dist')
})

test('desktop command path includes user-installed CLIs missing from Finder PATH', () => {
  const commandPath = buildDesktopCommandPath({
    existingPath: '/usr/bin:/bin',
    homeDirectory: '/Users/example',
    nvmBinDirectories: [
      '/Users/example/.nvm/versions/node/v24.0.0/bin',
      '/Users/example/.nvm/versions/node/v22.0.0/bin',
    ],
  })

  assert.deepEqual(commandPath.split(path.delimiter), [
    '/Users/example/.nvm/versions/node/v24.0.0/bin',
    '/Users/example/.nvm/versions/node/v22.0.0/bin',
    '/Users/example/.local/bin',
    '/Users/example/.bun/bin',
    '/Users/example/.cargo/bin',
    '/Users/example/go/bin',
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
  ])
})

test('desktop DB config prefers saved .env DSN over default database path', async () => {
  const userDataPath = await mkdtemp(path.join(tmpdir(), 'atolla-runtime-'))
  const paths = resolveRuntimePaths({
    isPackaged: true,
    resourcesPath: '/Applications/Atolla.app/Contents/Resources',
    userDataPath,
    repositoryRoot: '/workspace/Atolla',
  })
  const custom = path.join(userDataPath, 'shared', 'team.db')
  await writeFile(path.join(userDataPath, '.env'), `AVATAR_DB_DRIVER=sqlite\nAVATAR_DB_DSN=${custom}\n`)
  const resolved = resolveDesktopDatabaseConfig({
    inheritedEnvironment: {},
    isPackaged: true,
    paths,
  })
  assert.equal(resolved.dsn, custom)
  const environment = buildBackendEnvironment({
    inheritedEnvironment: { HOME: '/Users/example', PATH: '/usr/bin:/bin' },
    isPackaged: true,
    paths,
    port: 18080,
  })
  assert.equal(environment.AVATAR_DB_DSN, custom)
  assert.equal(environment.AVATAR_DB_DRIVER, 'sqlite')
})

test('backend pipes output instead of passing an unopened log stream to spawn stdio', async () => {
  const userDataPath = await mkdtemp(path.join(tmpdir(), 'atolla-runtime-'))
  const paths = resolveRuntimePaths({
    isPackaged: true,
    resourcesPath: '/Applications/Atolla.app/Contents/Resources',
    userDataPath,
    repositoryRoot: '/workspace/Atolla',
  })
  const fakeChild = new EventEmitter()
  fakeChild.stdout = new PassThrough()
  fakeChild.stderr = new PassThrough()
  fakeChild.exitCode = 0
  fakeChild.signalCode = null
  let spawnOptions

  const runtime = await startBackend({
    paths,
    isPackaged: true,
    spawnImpl: (_command, _arguments, options) => {
      spawnOptions = options
      return fakeChild
    },
    fetchImpl: async () => ({ ok: true }),
  })

  assert.deepEqual(spawnOptions.stdio, ['ignore', 'pipe', 'pipe'])
  await runtime.stop()
})

test('resolveDesktopListenPort persists port for stable origin', async () => {
  const userDataPath = await mkdtemp(path.join(tmpdir(), 'atolla-port-'))
  const paths = resolveRuntimePaths({
    isPackaged: true,
    resourcesPath: '/Applications/Atolla.app/Contents/Resources',
    userDataPath,
    repositoryRoot: '/workspace/Atolla',
  })
  await ensureRuntimeDirectories(paths)
  const first = await resolveDesktopListenPort({ configDir: paths.configDir, preferredPort: 19800 })
  assert.equal(first, 19800)
  assert.equal(readSavedDesktopPort(paths.configDir), 19800)
  const second = await resolveDesktopListenPort({ configDir: paths.configDir, preferredPort: 0 })
  assert.equal(second, 19800)
})

test('sandboxed preload exposes only the approved desktop IPC actions', async () => {
  const source = await readFile(new URL('../preload.cjs', import.meta.url), 'utf8')
  let exposed
  const calls = []
  const contextBridge = { exposeInMainWorld: (name, api) => { exposed = { name, api } } }
  const ipcRenderer = { invoke: (...args) => { calls.push(args); return Promise.resolve(args) } }

  // 沙箱预加载脚本以普通脚本执行；这里不提供 ESM 加载器。
  new vm.Script(source, { filename: 'preload.cjs' }).runInNewContext({
    require: (name) => {
      assert.equal(name, 'electron')
      return { contextBridge, ipcRenderer }
    },
  })

  assert.equal(exposed.name, 'atollaDesktop')
  await exposed.api.pickSQLiteFile('save')
  await exposed.api.pickSQLiteFile('unexpected')
  await exposed.api.relaunchApp()
  assert.deepEqual(calls, [
    ['atolla:pick-sqlite-file', 'save'],
    ['atolla:pick-sqlite-file', 'open'],
    ['atolla:relaunch-app'],
  ])
})

test('development backend refuses an occupied Vite proxy port instead of silently switching ports', async () => {
  const listener = createServer()
  await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve))
  const port = listener.address().port
  const configDir = await mkdtemp(path.join(tmpdir(), 'atolla-dev-port-'))
  try {
    await assert.rejects(
      resolveDesktopListenPort({ configDir, preferredPort: port, strictPreferred: true }),
      /开发后端端口.*被占用/,
    )
  } finally {
    await new Promise((resolve) => listener.close(resolve))
  }
})

test('runner owns a separate Go process group and mirrors backend logs to the terminal', async () => {
  const userDataPath = await mkdtemp(path.join(tmpdir(), 'atolla-dev-runner-'))
  const paths = resolveRuntimePaths({ isPackaged: false, resourcesPath: '/ignored', userDataPath, repositoryRoot: '/workspace/Atolla' })
  const child = new EventEmitter()
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.exitCode = 0
  child.signalCode = null
  let options
  const output = []
  const backend = await startBackend({
    paths, isPackaged: false, preferredPort: 0, detached: true,
    onOutput: (chunk) => output.push(String(chunk)),
    spawnImpl: (_command, _args, spawnOptions) => { options = spawnOptions; return child },
    fetchImpl: async () => ({ ok: true }),
  })
  child.stdout.write('backend ready\n')
  assert.equal(options.detached, true)
  assert.deepEqual(output, ['backend ready\n'])
  await backend.stop()
})
