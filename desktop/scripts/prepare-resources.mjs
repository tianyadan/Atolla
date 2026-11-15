import { access, cp, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url))
const desktopDirectory = path.resolve(scriptsDirectory, '..')
const repositoryRoot = path.resolve(desktopDirectory, '..')
const webDist = path.join(repositoryRoot, 'web', 'dist')
const stageDirectory = path.join(desktopDirectory, 'stage')
const stagedWeb = path.join(stageDirectory, 'web')

await access(path.join(webDist, 'index.html'))
await access(path.join(stageDirectory, 'bin', 'atolla-server'))
await mkdir(stageDirectory, { recursive: true })
await cp(webDist, stagedWeb, { recursive: true, force: true })
