import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import path from 'node:path'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { PassThrough } from 'node:stream'
import { buildBackendEnvironment, buildDesktopCommandPath, ensureRuntimeDirectories, resolveRuntimePaths, startBackend } from '../runtime.mjs'

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
