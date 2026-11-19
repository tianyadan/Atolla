const { contextBridge, ipcRenderer } = require('electron')

// 沙箱 preload 以普通脚本运行；仅向页面暴露必要的 IPC 白名单。
contextBridge.exposeInMainWorld('atollaDesktop', {
  /** mode: 'open' | 'save' → { path } | { cancelled: true } | { error } */
  pickSQLiteFile: (mode) => ipcRenderer.invoke('atolla:pick-sqlite-file', mode === 'save' ? 'save' : 'open'),
  /** 数据库/运行时配置变更后重启整应用（含内嵌后端）。 */
  relaunchApp: () => ipcRenderer.invoke('atolla:relaunch-app'),
})
