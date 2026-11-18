import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inspectBootDirs } from '../../packages/dsh-bridge/transport/channel.mjs'
import { probeHeartbeat } from '../../packages/dsh-bridge/transport/mailbox.mjs'
import { PROBE_VERSION } from '../../packages/dsh-bridge/adapters/unity/index.mjs'

// BUG-001：心跳不能单独代表「通道可用」。
//
// 现场是 pid 存活、lastSeenAt 每 2 秒刷新、bridge_targets 显示 ready，
// 但 instance.json 声明的 bootId 目录根本不存在，于是调用持续报
// `bridge mailbox missing`。故障对 DSH 完全透明——这正是要消灭的盲区。

const BOOT = 'a040d9c7263944d2'
const SUBS = ['inbox', 'outbox', 'events', 'done', 'in-progress']

async function project({ bootId = BOOT, dirs = SUBS, pid = process.pid, lastSeenAt } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-bridge-bug1-'))
  const channelRoot = join(root, 'Library', 'DSHBridge')
  await mkdir(channelRoot, { recursive: true })
  await writeFile(
    join(channelRoot, 'instance.json'),
    JSON.stringify({
      v: 1,
      discoveryVersion: 1,
      instanceId: 'unity:0cc0da6ed536',
      bootId,
      nonce: 'a8d2065d59fc4cb4b5745b6da7cf33e4',
      pid,
      probeVersion: PROBE_VERSION,
      lastSeenAt: lastSeenAt ?? new Date().toISOString(),
      staleAfterMs: 15000,
      capabilities: ['unity.editor.status'],
    }),
  )
  for (const sub of dirs) await mkdir(join(channelRoot, bootId, sub), { recursive: true })
  return root
}

test('通道目录齐全时判定 ok', async () => {
  const root = await project()
  try {
    const result = await inspectBootDirs(root, BOOT)
    assert.equal(result.ok, true)
    assert.deepEqual(result.missing, [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('目录完全不存在时列出全部缺失项（现场形态）', async () => {
  const root = await project({ dirs: [] })
  try {
    const result = await inspectBootDirs(root, BOOT)
    assert.equal(result.ok, false)
    assert.deepEqual(result.missing.sort(), [...SUBS].sort())
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('只缺一个子目录也判为不全', async () => {
  const root = await project({ dirs: SUBS.filter((sub) => sub !== 'inbox') })
  try {
    const result = await inspectBootDirs(root, BOOT)
    assert.equal(result.ok, false)
    assert.deepEqual(result.missing, ['inbox'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('bootId 非法时直接判为缺失，不越界 stat', async () => {
  for (const bad of ['../etc/passwd', 'ABCDEF0123456789', 'short', '', null]) {
    const result = await inspectBootDirs('/tmp', bad)
    assert.equal(result.ok, false, `bootId=${bad} 必须被判为不可用`)
    assert.deepEqual(result.missing, ['bootId_invalid'])
  }
})

test('心跳新鲜 + 进程存活 + 目录齐全 = ready', async () => {
  const root = await project()
  try {
    const heartbeat = await probeHeartbeat(root)
    assert.equal(heartbeat.status, 'ready')
    assert.equal(heartbeat.channelOk, true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('心跳新鲜但目录缺失 = channel_missing（不能是 ready）', async () => {
  const root = await project({ dirs: [] })
  try {
    const heartbeat = await probeHeartbeat(root)
    assert.equal(heartbeat.status, 'channel_missing', '目录缺失绝不能被 ready 掩盖')
    assert.equal(heartbeat.channelOk, false)
    assert.equal(heartbeat.missing, undefined)
    assert.equal(heartbeat.channelMissing.length, SUBS.length)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('进程已消失时优先报 stale，不为陈旧实例纠结目录', async () => {
  // pid 取一个几乎不可能存在的值。
  const root = await project({ dirs: [] })
  try {
    await mkdir(join(root, 'placeholder'), { recursive: true })
    const channelRoot = join(root, 'Library', 'DSHBridge')
    await writeFile(
      join(channelRoot, 'instance.json'),
      JSON.stringify({
        bootId: BOOT,
        nonce: 'x',
        pid: 2147483646,
        probeVersion: PROBE_VERSION,
        lastSeenAt: new Date().toISOString(),
        staleAfterMs: 15000,
      }),
    )
    const heartbeat = await probeHeartbeat(root)
    assert.equal(heartbeat.status, 'stale', '进程不在时 stale 是更根本的结论')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('心跳陈旧时优先报 idle，不因目录暂时未见就报 channel_missing', async () => {
  // 后台节流时目录可能只是还没被自愈心跳重建出来；此时唤醒后仍可恢复。
  const root = await project({ dirs: [], lastSeenAt: new Date(Date.now() - 60000).toISOString() })
  try {
    const heartbeat = await probeHeartbeat(root)
    assert.equal(heartbeat.status, 'idle')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
