/**
 * 是否应跳过首次引擎/数据库引导页。
 * Electron 打包态若端口每次变化，localStorage 会丢；故以服务端状态为准。
 */
export function shouldSkipOnboarding({ needsRegister, engines, dbChosen, localDone }) {
  if (localDone) return true
  // 库里已有管理员：说明本机已初始化过
  if (needsRegister === false) return true
  const list = Array.isArray(engines) ? engines : []
  const anyEngine = list.some((e) => e && e.installed)
  // 引擎可用且数据库已确认过
  if (anyEngine && dbChosen) return true
  return false
}
