import { contextBridge, ipcRenderer } from 'electron'

// 最小权限白名单：仅暴露 SQLite 文件选择与应用重启，不暴露任意 FS/shell。
contextBridge.exposeInMainWorld('atollaDesktop', {
  /** mode: 'open' | 'save' → { path } | { cancelled: true } | { error } */
  pickSQLiteFile: (mode) => ipcRenderer.invoke('atolla:pick-sqlite-file', mode === 'save' ? 'save' : 'open'),
  /** 数据库/运行时配置变更后重启整应用（含内嵌后端）。 */
  relaunchApp: () => ipcRenderer.invoke('atolla:relaunch-app'),
})
