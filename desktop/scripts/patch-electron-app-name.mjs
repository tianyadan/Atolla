#!/usr/bin/env node
/**
 * 开发态 Electron.app 默认叫 "Electron"。把 Info.plist 显示名改成 Atolla，
 * 这样 Dock / 菜单栏 / 强制退出列表不再显示 Electron。
 * npm ci / npm install 后会还原，故由 postinstall 再跑一次。
 */
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const APP_NAME = 'Atolla'
const desktopDirectory = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const plistPath = path.join(
  desktopDirectory,
  'node_modules',
  'electron',
  'dist',
  'Electron.app',
  'Contents',
  'Info.plist',
)

if (process.platform !== 'darwin') {
  process.exit(0)
}

if (!existsSync(plistPath)) {
  console.warn(`[patch-electron-app-name] 跳过：未找到 ${plistPath}`)
  process.exit(0)
}

const buddy = '/usr/libexec/PlistBuddy'

/** 设置或新增 plist 键。 */
function setKey(key, value) {
  const print = spawnSync(buddy, ['-c', `Print :${key}`, plistPath], { encoding: 'utf8' })
  const cmd = print.status === 0
    ? `Set :${key} ${value}`
    : `Add :${key} string ${value}`
  const r = spawnSync(buddy, ['-c', cmd, plistPath], { encoding: 'utf8' })
  if (r.status !== 0) {
    console.error(`[patch-electron-app-name] 失败 ${key}:`, r.stderr || r.stdout)
    process.exit(1)
  }
}

setKey('CFBundleName', APP_NAME)
setKey('CFBundleDisplayName', APP_NAME)
console.log(`[patch-electron-app-name] ${plistPath} → ${APP_NAME}`)
