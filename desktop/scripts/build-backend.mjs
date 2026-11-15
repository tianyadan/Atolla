import { spawnSync } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url))
const desktopDirectory = path.resolve(scriptsDirectory, '..')
const repositoryRoot = path.resolve(desktopDirectory, '..')
const outputDirectory = path.join(desktopDirectory, 'stage', 'bin')
const outputPath = path.join(outputDirectory, 'atolla-server')

await mkdir(outputDirectory, { recursive: true })
const result = spawnSync('go', ['build', '-o', outputPath, '.'], {
  cwd: path.join(repositoryRoot, 'server'),
  env: { ...process.env, GOOS: 'darwin', GOARCH: 'arm64', CGO_ENABLED: '0' },
  stdio: 'inherit',
})

if (result.error) {
  throw new Error(`无法执行 Go 构建：${result.error.message}`)
}
if (result.status !== 0) {
  throw new Error(`Go arm64 构建失败，退出码 ${result.status}`)
}
