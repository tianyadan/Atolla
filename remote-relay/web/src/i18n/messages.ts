import type { LocaleId } from './locale'

type Dict = Record<string, string>

/** App 设置相关文案；en 缺键回退 zh-CN */
export const messages: Record<LocaleId, Dict> = {
  'zh-CN': {
    'settings.title': '设置',
    'settings.app': '应用',
    'settings.relayVersion': '中继版本',
    'settings.appUi': 'App 界面',
    'settings.language': '语言',
    'settings.languageLabel': '界面语言',
    'settings.otpLogin': '验证码登录',
    'settings.otpHint':
      '接收邮箱用于「验证码登录」。还需在 Mac「远程中继」配置并校验发送邮箱 SMTP。',
    'settings.otpCurrent': '当前：{email}',
    'settings.receiveEmail': '接收邮箱',
    'settings.saveReceive': '保存接收邮箱',
    'settings.saving': '保存中…',
    'settings.relayService': '中继服务',
    'settings.relayHint':
      'App 壳内无浏览器同源代理，请填写可访问的中继根地址（含 https://，不要末尾斜杠）。',
    'settings.apiBase': 'API 地址',
    'settings.save': '保存',
    'settings.saved': '已保存',
    'settings.other': '其它',
    'settings.otherHint':
      '通知、JEV 等与电脑数字人相关的选项，请进入某台电脑后，在「功能 → 设置」中配置。',
    'settings.changelog': '更新记录',
    'settings.changelogSub': '查看各版本变更',
    'settings.notify': '通知',
    'settings.notify.taskDone': '完成通知',
    'settings.notify.permission': '命令审批通知',
    'settings.notify.code': '验证码',
    'settings.notify.send': '发送',
    'settings.notify.confirm': '确认',
    'settings.notify.cancel': '取消',
    'instance.settings': '设置',
  },
  en: {
    'settings.title': 'Settings',
    'settings.app': 'App',
    'settings.relayVersion': 'Relay version',
    'settings.appUi': 'App UI',
    'settings.language': 'Language',
    'settings.languageLabel': 'UI language',
    'settings.otpLogin': 'OTP login',
    'settings.otpHint':
      'Inbox for OTP login. Also configure and verify SMTP on the Mac remote relay.',
    'settings.otpCurrent': 'Current: {email}',
    'settings.receiveEmail': 'Inbox email',
    'settings.saveReceive': 'Save inbox',
    'settings.saving': 'Saving…',
    'settings.relayService': 'Relay',
    'settings.relayHint':
      'Native app has no same-origin proxy. Enter the relay root URL (https://, no trailing slash).',
    'settings.apiBase': 'API base',
    'settings.save': 'Save',
    'settings.saved': 'Saved',
    'settings.other': 'Other',
    'settings.otherHint':
      'Notification and JEV options live under a computer: Features → Settings.',
    'settings.changelog': 'Changelog',
    'settings.changelogSub': 'Release notes',
    'settings.notify': 'Notifications',
    'settings.notify.taskDone': 'Task done',
    'settings.notify.permission': 'Command approval',
    'settings.notify.code': 'Code',
    'settings.notify.send': 'Send',
    'settings.notify.confirm': 'Confirm',
    'settings.notify.cancel': 'Cancel',
    'instance.settings': 'Settings',
  },
}

/** 简单插值 */
export function formatMessage(template: string, vars?: Record<string, string | number>): string {
  if (!vars || !template) return template || ''
  return String(template).replace(/\{(\w+)\}/g, (_, k: string) =>
    vars[k] == null ? `{${k}}` : String(vars[k]),
  )
}
