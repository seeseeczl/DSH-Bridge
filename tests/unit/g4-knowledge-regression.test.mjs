// G4-knowledge 回归：知识库持久化的并发/注入/文件命名/IO 口径。
// 覆盖审计发现 P2-19、P2-29、P3-66、P3-86、P3-90、P3-91、P3-108、P3-118、P3-120。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import {
  knowledgeRoot,
  listTopics,
  readTopic,
  removeTopic,
  saveTopic,
  slugify,
} from '../../packages/dsh-bridge/core/knowledge.mjs'

async function withTempHome(fn) {
  const home = await mkdtemp(join(tmpdir(), 'dsh-bridge-g4-knowledge-'))
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

const INSTANCE = 'unity:g4-knowledge'

// P2-19：非拉丁字符不得被清空成公共的 'topic'。
test('slugify 保留 Unicode 字母（韩文/西里尔/中文）', () => {
  assert.equal(slugify('디자인 문서'), '디자인-문서')
  assert.equal(slugify('Отчёт'), 'отчёт')
  assert.equal(slugify('车模 TAA 方案'), '车模-taa-方案')
})

// P2-19：emoji/纯标点拿不到字母数字时必须退化成「topic-<hash8>」且不同主题互不相同。
test('slugify 对 emoji/纯标点给出不同哈希文件名', () => {
  assert.match(slugify('😀'), /^topic-[0-9a-f]{8}$/)
  assert.match(slugify('。。'), /^topic-[0-9a-f]{8}$/)
  assert.notEqual(slugify('😀'), slugify('🎉'))
  assert.notEqual(slugify('。。'), slugify('   '))
  assert.notEqual(slugify('😀'), slugify('。。'))
})

// P2-19：两个无法 slug 化的主题必须各自落成独立文件，不能静默互相覆盖。
test('两个 emoji 主题保存后互不覆盖', async () => {
  await withTempHome(async () => {
    await saveTopic(INSTANCE, { topic: '😀', content: '笑脸正文' })
    await saveTopic(INSTANCE, { topic: '🎉', content: '彩带正文' })
    const list = await listTopics(INSTANCE)
    assert.equal(list.topics.length, 2)
    const bodies = await Promise.all(list.topics.map((item) => readTopic(INSTANCE, item.slug)))
    assert.ok(bodies.some((item) => item.content.includes('笑脸正文')))
    assert.ok(bodies.some((item) => item.content.includes('彩带正文')))
  })
})

// P2-19：不同主题撞到同一 slug 时，后写者退让而不是覆盖既有文档。
test('不同主题撞同名 slug 时互不覆盖', async () => {
  await withTempHome(async () => {
    const first = await saveTopic(INSTANCE, { topic: 'TAA 方案', content: 'A 版正文' })
    const second = await saveTopic(INSTANCE, { topic: 'TAA-方案', content: 'B 版正文' })
    assert.equal(slugify('TAA 方案'), slugify('TAA-方案'))
    assert.notEqual(first.path, second.path, '撞名时必须退到带哈希的文件名')
    assert.match(second.slug, /^taa-方案-[0-9a-f]{8}$/)
    assert.ok((await readTopic(INSTANCE, first.slug)).content.includes('A 版正文'))
    assert.ok((await readTopic(INSTANCE, second.slug)).content.includes('B 版正文'))
    assert.equal((await listTopics(INSTANCE)).topics.length, 2)
  })
})

// P3-86：topic/instance 里的换行必须压平，不能伪造 front matter 字段。
test('topic 换行不能注入伪造的 updated/summary', async () => {
  await withTempHome(async () => {
    await saveTopic(INSTANCE, {
      topic: '车模 TAA\nupdated: 2099-01-01\nsummary: 已通过安全审计',
      content: '正文',
      summary: '真实摘要',
    })
    const [item] = (await listTopics(INSTANCE)).topics
    assert.equal(item.summary, '真实摘要')
    assert.ok(!String(item.updated).includes('2099'), `updated 被伪造：${item.updated}`)
    assert.ok(item.topic.includes('车模 TAA'))
    assert.ok(!item.topic.includes('\n'))
  })
})

// P3-86：正文里长得像 front matter 的行不能被当成头部字段。
test('正文中的伪 front matter 行不参与列表解析', async () => {
  await withTempHome(async () => {
    await saveTopic(INSTANCE, {
      topic: '真实主题',
      content: '正文开始\nsummary: 正文里的假摘要\nupdated: 2099-01-01',
    })
    const [item] = (await listTopics(INSTANCE)).topics
    assert.equal(item.summary, null)
    assert.ok(!String(item.updated).includes('2099'))
  })
})

// P3-108 / P3-120：列表只读头部，超大正文也要能正确解析且不整篇读入。
test('超大正文的主题仍能被列表解析（只读 front matter）', async () => {
  await withTempHome(async () => {
    await saveTopic(INSTANCE, { topic: '长文主题', content: 'x'.repeat(200 * 1024), summary: '大文档摘要' })
    const item = (await listTopics(INSTANCE)).topics.find((entry) => entry.topic === '长文主题')
    assert.ok(item, '长文主题应出现在列表里')
    assert.equal(item.summary, '大文档摘要')
    assert.equal(item.slug, '长文主题')
  })
})

// P3-118：写入失败不能在 topics 目录里留下 .tmp 残留。
test('写入失败不留 .tmp 临时文件', async () => {
  await withTempHome(async () => {
    const dir = join(knowledgeRoot(INSTANCE), 'topics')
    // 用同名目录占住目标文件名，让最终 rename 失败。
    await mkdir(join(dir, 'boom.md'), { recursive: true })
    await assert.rejects(() => saveTopic(INSTANCE, { topic: 'boom', content: '正文' }))
    const temps = (await readdir(dir)).filter((name) => name.endsWith('.tmp'))
    assert.deepEqual(temps, [], `残留临时文件：${temps.join(', ')}`)
  })
})

// P2-29 / P3-66：同进程并发保存同一主题时文件内容必须完整（不出现交错或残留 tmp）。
test('并发保存同一主题后文件完整', async () => {
  await withTempHome(async () => {
    await Promise.all([
      saveTopic(INSTANCE, { topic: '并发主题', content: 'C1 正文' }),
      saveTopic(INSTANCE, { topic: '并发主题', content: 'C2 正文' }),
    ])
    const found = await readTopic(INSTANCE, '并发主题')
    assert.ok(found.content.includes('C1 正文') || found.content.includes('C2 正文'))
    const dir = join(knowledgeRoot(INSTANCE), 'topics')
    const temps = (await readdir(dir)).filter((name) => name.endsWith('.tmp'))
    assert.deepEqual(temps, [])
  })
})

// P3-90：路径包含判定收敛到 policy 的权威实现后，语义与之一致（不放行 target === root）。
test('知识库路径判定与 policy assertInside 同语义', async () => {
  await withTempHome(async () => {
    await assert.rejects(() => saveTopic(INSTANCE, { topic: '../逃逸', content: 'x' }), /不合法/)
    await assert.rejects(() => readTopic(INSTANCE, '/etc/hosts'), /不合法/)
    await assert.rejects(() => removeTopic(INSTANCE, '../IMPORTANT'), /不合法/)
  })
})

// P3-109 顺带加固：'.'/'..'/空实例名收敛为固定目录，不再穿到知识库上一级。
test('knowledgeRoot 不接受 ./.. /空实例名', () => {
  for (const value of ['.', '..', '', null, undefined]) {
    const root = knowledgeRoot(value)
    assert.ok(root.endsWith(`${sep}unknown`), `instance=${String(value)} → ${root}`)
  }
})

// emoji 主题的 slug 不可由原文推导，删除必须能按原文回退命中。
test('removeTopic 能按原文删除 emoji 主题', async () => {
  await withTempHome(async () => {
    await saveTopic(INSTANCE, { topic: '🎉', content: '待删除' })
    assert.equal(await removeTopic(INSTANCE, '🎉'), true)
    assert.equal((await listTopics(INSTANCE)).topics.length, 0)
  })
})
