import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bootPaths, ensureBootDirs, readEvents, writeEvent } from '../../packages/dsh-bridge/transport/mailbox.mjs'
import { sweepEvents } from '../../packages/dsh-bridge/transport/maintenance.mjs'

const BOOT = '0123456789abcdef'

async function setup() {
  const project = await mkdtemp(join(tmpdir(), 'dsh-bridge-events-'))
  await ensureBootDirs(project, BOOT)
  return project
}

async function writeRawEvents(project, count) {
  const paths = bootPaths(project, BOOT)
  // 串行写入：几百个并发 writeFile 会撞 macOS 默认 fd 上限（EMFILE）。
  for (let index = 0; index < count; index += 1) {
    await writeFile(
      join(paths.events, `evt_${String(index + 1).padStart(10, '0')}.json`),
      JSON.stringify({ seq: index + 1, kind: 'test' }),
      'utf8',
    )
  }
}

// AA-EVENT-004：事件目录被整体清空时 maxSeq 归零，旧游标必须复位，否则会永久跳过后续事件。
test('事件目录被整体清空后，旧游标复位而不是永久卡死', async () => {
  const project = await setup()
  await writeEvent(project, BOOT, { seq: 5, kind: 'x' })
  await writeEvent(project, BOOT, { seq: 6, kind: 'x' })

  const before = await readEvents(project, BOOT, 3)
  assert.equal(before.cursorReset, false)
  assert.equal(before.events.length, 2)

  const paths = bootPaths(project, BOOT)
  await rm(paths.events, { recursive: true, force: true })
  await ensureBootDirs(project, BOOT)

  const after = await readEvents(project, BOOT, 3)
  assert.equal(after.events.length, 0)
  assert.equal(after.cursorReset, true, 'maxSeq=0 时旧游标必须复位')
})

test('首次读取（afterSeq=0）不触发复位', async () => {
  const project = await setup()
  const result = await readEvents(project, BOOT, 0)
  assert.equal(result.cursorReset, false)
})

// AA-OPT-015 回归：多会话共享事件目录时，默认不按数量裁剪（旧实现 keep=500 会删掉未读事件）。
test('sweepEvents 默认不按数量裁剪', async () => {
  const project = await setup()
  await writeRawEvents(project, 600)

  const removed = await sweepEvents(project, BOOT)
  assert.equal(removed, 0, '未超过硬上限时不应删除任何事件')

  const result = await readEvents(project, BOOT, 0)
  assert.equal(result.events.length, 600)
})

test('显式 keep 收紧时仍按数量裁剪（保留最近 N 条）', async () => {
  const project = await setup()
  await writeRawEvents(project, 20)

  const removed = await sweepEvents(project, BOOT, { keep: 5 })
  assert.equal(removed, 15)

  const result = await readEvents(project, BOOT, 0)
  assert.deepEqual(result.events.map((event) => event.seq), [16, 17, 18, 19, 20])
})

test('超过 maxFiles 硬上限时裁掉最旧的，避免无限增长', async () => {
  const project = await setup()
  await writeRawEvents(project, 30)

  const removed = await sweepEvents(project, BOOT, { maxFiles: 10 })
  assert.equal(removed, 20)

  const result = await readEvents(project, BOOT, 0)
  assert.equal(result.events.length, 10)
})
