import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  deployLogExpiresAt,
  shouldShowDeployProgress,
} from './remoteRelayPanelModel.js'

test('未启动部署时隐藏日志，运行或存在终态日志时显示', () => {
  assert.equal(shouldShowDeployProgress({ status: '', logs: [], running: false }), false)
  assert.equal(shouldShowDeployProgress({ status: 'running', logs: [], running: true }), true)
  assert.equal(shouldShowDeployProgress({ status: 'ok', logs: ['done'], running: false }), true)
  assert.equal(shouldShowDeployProgress({ status: 'error', logs: [], running: false }), true)
})

test('运行中的部署日志不过期，成功和失败日志在十分钟后过期', () => {
  const completedAt = 1_700_000_000_000
  assert.equal(deployLogExpiresAt('running', completedAt), null)
  assert.equal(deployLogExpiresAt('', completedAt), null)
  assert.equal(deployLogExpiresAt('ok', completedAt), 1_700_000_600_000)
  assert.equal(deployLogExpiresAt('error', completedAt), 1_700_000_600_000)
})
