// 知识库主题删除：saveTopic 用 slugify(topic) 落盘，removeTopic 必须同时接受「原文标题」与「slug」。
// 背景（BUG-0002）：旧实现只用 safeTopicName(原文) 拼文件名，含全角括号/空格的主题删不掉，
// 且 rm(force: true) 不报错，导致工具返回「已删除」但文件仍在。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readTopic, removeTopic, saveTopic, slugify } from '../../packages/dsh-bridge/core/knowledge.mjs'

async function withTempHome(fn) {
  const home = await mkdtemp(join(tmpdir(), 'dsh-bridge-knowledge-'))
  const previous = process.env.HOME
  process.env.HOME = home
  try {
    return await fn(home)
  } finally {
    if (previous === undefined) delete process.env.HOME
    else process.env.HOME = previous
    await rm(home, { recursive: true, force: true })
  }
}

const TOPIC = '团结引擎能力验证（2026-11-18）'
const INSTANCE = 'unity:knowledge-test'

test('removeTopic 接受主题原文（含全角括号）', async () => {
  await withTempHome(async () => {
    const saved = await saveTopic(INSTANCE, { topic: TOPIC, content: '正文' })
    await stat(saved.path)
    assert.equal(await removeTopic(INSTANCE, TOPIC), true)
    await assert.rejects(() => stat(saved.path), /ENOENT/)
  })
})

test('removeTopic 接受 slug', async () => {
  await withTempHome(async () => {
    const saved = await saveTopic(INSTANCE, { topic: TOPIC, content: '正文' })
    assert.equal(saved.slug, slugify(TOPIC))
    assert.equal(await removeTopic(INSTANCE, saved.slug), true)
    await assert.rejects(() => stat(saved.path), /ENOENT/)
  })
})

test('removeTopic 对不存在的主题返回 false 而不是静默成功', async () => {
  await withTempHome(async () => {
    assert.equal(await removeTopic(INSTANCE, '不存在的主题'), false)
  })
})

test('removeTopic 仍拒绝路径逃逸', async () => {
  await withTempHome(async () => {
    await assert.rejects(() => removeTopic(INSTANCE, '../IMPORTANT'), /不合法/)
    await assert.rejects(() => removeTopic(INSTANCE, '/etc/hosts'), /不合法/)
  })
})

test('readTopic 用主题原文可读回保存内容', async () => {
  await withTempHome(async () => {
    await saveTopic(INSTANCE, { topic: TOPIC, content: '正文内容' })
    const found = await readTopic(INSTANCE, TOPIC)
    assert.ok(found.content.includes('正文内容'))
  })
})
