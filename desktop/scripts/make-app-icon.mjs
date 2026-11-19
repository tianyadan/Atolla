#!/usr/bin/env node
/**
 * 从方形品牌图生成带 macOS 圆角（透明四角）的 Electron 图标。
 * 依赖本机 Python3 + 临时 venv 安装 pillow（不写入项目依赖）。
 *
 * 用法：node scripts/make-app-icon.mjs
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const desktopDirectory = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const buildDir = path.join(desktopDirectory, 'build')
const squarePath = path.join(buildDir, 'icon-square.png')
const outPath = path.join(buildDir, 'icon.png')
const sourceFallback = path.resolve(
  desktopDirectory,
  '../remote-relay/web/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png',
)

mkdirSync(buildDir, { recursive: true })
const source = existsSync(squarePath) ? squarePath : sourceFallback
if (!existsSync(source)) {
  console.error(`找不到源图标：${source}`)
  process.exit(1)
}

const venv = path.join(tmpdir(), 'atolla-icon-venv')
const py = path.join(venv, 'bin', 'python')
const pip = path.join(venv, 'bin', 'pip')

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

if (!existsSync(py)) {
  run('python3', ['-m', 'venv', venv])
  run(pip, ['install', '-q', 'pillow', '-i', 'https://pypi.tuna.tsinghua.edu.cn/simple'])
}

const script = `
from PIL import Image, ImageDraw
from pathlib import Path
src = Path(${JSON.stringify(source)})
out = Path(${JSON.stringify(outPath)})
square = Path(${JSON.stringify(squarePath)})
im = Image.open(src).convert('RGBA')
w, h = im.size
if w != h:
    raise SystemExit(f'icon must be square, got {w}x{h}')
if not square.exists():
    im.save(square, format='PNG')
radius = int(round(w * 0.2237))
mask = Image.new('L', (w, h), 0)
draw = ImageDraw.Draw(mask)
draw.rounded_rectangle((0, 0, w - 1, h - 1), radius=radius, fill=255)
rounded = Image.new('RGBA', (w, h), (0, 0, 0, 0))
rounded.paste(im, (0, 0), mask=mask)
rounded.save(out, format='PNG', optimize=True)
print(f'wrote {out} radius={radius}')
`

run(py, ['-c', script])
