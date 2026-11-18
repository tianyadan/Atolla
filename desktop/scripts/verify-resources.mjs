import { access, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url))
const desktopDirectory = path.resolve(scriptsDirectory, '..')
const stageDirectory = path.join(desktopDirectory, 'stage')
const serverPath = path.join(stageDirectory, 'bin', 'atolla-server')
const indexPath = path.join(stageDirectory, 'web', 'index.html')

await access(indexPath)
const serverInfo = await stat(serverPath)
if (!serverInfo.isFile() || (serverInfo.mode & 0o111) === 0) {
  throw new Error(`缺少可执行的 arm64 后端：${serverPath}`)
}
