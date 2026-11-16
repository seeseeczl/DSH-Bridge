import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  bootPaths,
  purgeRequest,
  readEvents,
  readInstance,
  takeResponse,
  waitForResponse,
  writeEvent,
  writeRequest,
  writeResponse,
} from '../../packages/dsh-bridge/transport/mailbox.mjs'
import { backlog, sweepEvents } from '../../packages/dsh-bridge/transport/maintenance.mjs'

const project = () => mkdtemp(join(tmpdir(), 'dsh-bridge-mailbox-'))
const identityFor = (dir) => ({ instanceId: 'unity:x', bootId: 'b1', nonce: 'n1', projectPath: dir })

test('请求原子投递且不残留临时文件', async () => {
  const dir = await project()
  await writeRequest(dir, 'boot1', { id: 'req_1', v: 1 })
  const { inbox } = bootPaths(dir, 'boot1')
  const names = await readdir(inbox)
  assert.deepEqual(names, ['req_1.json'])
  assert.equal(names.some((n) => n.endsWith('.tmp')), false)
  assert.equal(JSON.parse(await readFile(join(inbox, 'req_1.json'), 'utf8')).id, 'req_1')
})

test('精确取件：只消费自己的响应，别人的留在原地', async () => {
  const dir = await project()
  await writeResponse(dir, 'b1', { id: 'req_a', instanceId: 'unity:x', bootId: 'b1', nonce: 'n1', ok: true })
  await writeResponse(dir, 'b1', { id: 'req_b', instanceId: 'unity:x', bootId: 'b1', nonce: 'n1', ok: true })

  const identity = identityFor(dir)
  const mine = await takeResponse(identity, 'req_a')
  assert.equal(mine.id, 'req_a')

  const { outbox } = bootPaths(dir, 'b1')
  assert.deepEqual(await readdir(outbox), ['req_b.json'], '另一个等待者的响应不得被消费')

  const other = await takeResponse(identity, 'req_b')
  assert.equal(other.id, 'req_b')
  assert.deepEqual(await readdir(outbox), [])
})

test('同一响应不会被取两次', async () => {
  const dir = await project()
  const identity = identityFor(dir)
  await writeResponse(dir, 'b1', { id: 'req_1', instanceId: 'unity:x', bootId: 'b1', nonce: 'n1', ok: true })
  assert.ok(await takeResponse(identity, 'req_1'))
  assert.equal(await takeResponse(identity, 'req_1'), null)
})

test('配对不匹配的响应被消费并报错，不阻塞等待', async () => {
  const dir = await project()
  const identity = identityFor(dir)
  await writeResponse(dir, 'b1', { id: 'req_1', instanceId: 'unity:x', bootId: 'b1', nonce: 'WRONG', ok: true })
  await assert.rejects(() => takeResponse(identity, 'req_1'), (e) => e.code === 'pairing_mismatch')
})

test('超时撤回请求：purgeRequest 让过期指令不再被执行', async () => {
  const dir = await project()
  const identity = identityFor(dir)
  await writeRequest(dir, 'b1', { id: 'req_stale' })
  const { inbox, done } = bootPaths(dir, 'b1')
  assert.deepEqual(await readdir(inbox), ['req_stale.json'])

  assert.equal(await purgeRequest(dir, 'b1', 'req_stale'), true)
  assert.deepEqual(await readdir(inbox), [])
  assert.deepEqual(await readdir(done), ['req_stale.purged'])

  assert.equal(await purgeRequest(dir, 'b1', 'req_absent'), false)
})

test('事件按游标读取且不重复', async () => {
  const dir = await project()
  await writeEvent(dir, 'b1', { seq: 1, kind: 'a' })
  await writeEvent(dir, 'b1', { seq: 2, kind: 'b' })
  const all = await readEvents(dir, 'b1', 0)
  assert.deepEqual(all.events.map((e) => e.seq), [1, 2])
  assert.equal(all.cursorReset, false)
  const tail = await readEvents(dir, 'b1', 1)
  assert.deepEqual(tail.events.map((e) => e.seq), [2])
})

test('游标大于最大序号时报告 cursorReset', async () => {
  const dir = await project()
  await writeEvent(dir, 'b1', { seq: 1, kind: 'a' })
  const result = await readEvents(dir, 'b1', 99)
  assert.equal(result.events.length, 0)
  assert.equal(result.cursorReset, true)
})

test('事件回收保留最近窗口', async () => {
  const dir = await project()
  for (let i = 1; i <= 12; i += 1) await writeEvent(dir, 'b1', { seq: i, kind: 'k' })
  const removed = await sweepEvents(dir, 'b1', { keep: 5, maxAgeMs: 0 })
  assert.equal(removed, 7)
  const { events } = bootPaths(dir, 'b1')
  assert.equal((await readdir(events)).length, 5)
})

test('通道积压统计', async () => {
  const dir = await project()
  await writeRequest(dir, 'b1', { id: 'r1' })
  await writeRequest(dir, 'b1', { id: 'r2' })
  await writeResponse(dir, 'b1', { id: 'r1' })
  const counts = await backlog(dir, 'b1')
  assert.equal(counts.inbox, 2)
  assert.equal(counts.outbox, 1)
})

test('等待响应：别人的响应不影响自己，超时只在自己 deadline 触发', async () => {
  const dir = await project()
  const identity = identityFor(dir)
  const promise = waitForResponse(identity, 'req_ok', { timeoutMs: 1500, pollMs: 15 })
  await writeResponse(dir, 'b1', { id: 'req_other', instanceId: 'unity:x', bootId: 'b1', nonce: 'n1', ok: true })
  await writeResponse(dir, 'b1', { id: 'req_ok', instanceId: 'unity:x', bootId: 'b1', nonce: 'n1', ok: true, data: { v: 1 } })
  const response = await promise
  assert.equal(response.id, 'req_ok')
  // 别人的响应仍在 outbox，交给它自己的等待者。
  const { outbox } = bootPaths(dir, 'b1')
  assert.deepEqual(await readdir(outbox), ['req_other.json'])
})

test('等待超时抛出 timeout', async () => {
  const dir = await project()
  const identity = identityFor(dir)
  await assert.rejects(
    () => waitForResponse(identity, 'req_none', { timeoutMs: 80, pollMs: 10 }),
    (error) => error.code === 'timeout',
  )
})

test('instance.json 读取与缺失', async () => {
  const dir = await project()
  assert.equal(await readInstance(dir), null)
  const root = join(dir, 'Library', 'DSHBridge')
  await (await import('node:fs/promises')).mkdir(root, { recursive: true })
  await writeFile(join(root, 'instance.json'), JSON.stringify({ bootId: 'b1' }))
  assert.equal((await readInstance(dir)).bootId, 'b1')
})
