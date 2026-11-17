// 主题知识库：把「某个功能的实现方案」落成可复用的本地文档。
// 只存结论，不存全工程清单；文件位于 DSH 侧，不进目标工程。
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'

export function knowledgeRoot(instanceId) {
  const safe = String(instanceId ?? 'unknown').replace(/[^a-zA-Z0-9._-]/g, '_')
  return join(homedir(), '.dsh', 'bridge', 'knowledge', safe)
}

/** 主题文件名只允许安全字符；任何 ../ 与绝对路径都会被收纳成普通名字（AA-OPT-016）。 */
export function safeTopicName(slugOrTopic) {
  const raw = String(slugOrTopic ?? '').trim()
  const base = raw.replace(/\.md$/i, '')
  if (!base) throw Object.assign(new Error('缺少 topic'), { code: 'invalid_argument' })
  if (base.includes('/') || base.includes('\\') || base.startsWith('.') || base.includes('..')) {
    throw Object.assign(new Error(`topic 名称不合法：${base}`), { code: 'invalid_argument' })
  }
  return base
}

export function slugify(topic) {
  const base = String(topic).trim().toLowerCase()
    .replace(/[\s/\\]+/g, '-')
    .replace(/[^a-z0-9\u4e00-\u9fa5._-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  // 纯中文主题在部分文件系统上仍可用，但保留长度上限避免路径过长。
  return (base || 'topic').slice(0, 80)
}

/** 确保最终路径仍在 topics 目录内（防止符号链接或异常 slug 逃逸）。 */
function assertInsideTopics(dir, file) {
  const base = resolve(dir)
  const full = resolve(file)
  if (full !== base && !full.startsWith(`${base}${sep}`)) {
    throw Object.assign(new Error(`知识库路径越界：${file}`), { code: 'path_escape' })
  }
  return full
}

async function writeAtomic(path, text) {
  const tmp = `${path}.${process.pid}.tmp`
  await writeFile(tmp, text, 'utf8')
  await (await import('node:fs/promises')).rename(tmp, path)
}

/** 保存一个主题知识文档；同主题覆盖更新。 */
export async function saveTopic(instanceId, { topic, content, sources = [], summary = '' }) {
  if (!topic) throw Object.assign(new Error('缺少 topic'), { code: 'invalid_argument' })
  if (!content) throw Object.assign(new Error('缺少 content'), { code: 'invalid_argument' })
  const root = knowledgeRoot(instanceId)
  const dir = join(root, 'topics')
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const slug = slugify(topic)
  const file = join(dir, `${safeTopicName(slug)}.md`)
  const createdAt = new Date().toISOString()
  const header = [
    '---',
    `topic: ${topic}`,
    `instance: ${instanceId ?? ''}`,
    `updated: ${createdAt}`,
    summary ? `summary: ${summary.replace(/\n/g, ' ')}` : null,
    '---',
    '',
  ].filter(Boolean).join('\n')
  const sourceBlock = sources.length > 0
    ? `\n\n## 来源\n${sources.map((item) => `- \`${item}\``).join('\n')}\n`
    : '\n'
  const body = `${header}${content.trim()}\n${sourceBlock}`
  await writeAtomic(assertInsideTopics(dir, file), body)
  return { path: file, slug, topic, bytes: Buffer.byteLength(body, 'utf8'), updated: createdAt }
}

/** 列出已保存的主题。 */
export async function listTopics(instanceId) {
  const dir = join(knowledgeRoot(instanceId), 'topics')
  let names
  try {
    names = await readdir(dir)
  } catch {
    return { topics: [] }
  }
  const topics = []
  for (const name of names.filter((item) => item.endsWith('.md')).sort()) {
    const file = join(dir, name)
    const text = await readFile(file, 'utf8').catch(() => '')
    const title = /^topic:\s*(.+)$/m.exec(text)?.[1]?.trim() ?? name.replace(/\.md$/, '')
    const updated = /^updated:\s*(.+)$/m.exec(text)?.[1]?.trim() ?? null
    const summary = /^summary:\s*(.+)$/m.exec(text)?.[1]?.trim() ?? null
    topics.push({ slug: name.replace(/\.md$/, ''), topic: title, summary, updated })
  }
  return { topics }
}

/** 读取一个主题；slug 或标题都可。 */
export async function readTopic(instanceId, slugOrTopic) {
  const dir = join(knowledgeRoot(instanceId), 'topics')
  const direct = join(dir, `${safeTopicName(slugOrTopic)}.md`)
  try {
    const text = await readFile(assertInsideTopics(dir, direct), 'utf8')
    return { path: direct, content: text }
  } catch {
    // 回退：按标题匹配
  }
  const list = await listTopics(instanceId)
  const match = list.topics.find((item) => item.topic === slugOrTopic || item.slug === slugify(slugOrTopic))
  if (!match) return null
  const file = join(dir, `${match.slug}.md`)
  return { path: file, content: await readFile(file, 'utf8') }
}

/** 删除一个主题。 */
export async function removeTopic(instanceId, slugOrTopic) {
  const file = join(knowledgeRoot(instanceId), 'topics', `${safeTopicName(slugOrTopic)}.md`)
  try {
    await rm(assertInsideTopics(join(knowledgeRoot(instanceId), 'topics'), file), { force: true })
    return true
  } catch {
    return false
  }
}

export async function knowledgeStats(instanceId) {
  const root = knowledgeRoot(instanceId)
  const list = await listTopics(instanceId)
  let totalBytes = 0
  for (const item of list.topics) {
    const info = await stat(join(root, 'topics', `${item.slug}.md`)).catch(() => null)
    if (info) totalBytes += info.size
  }
  return { root, topics: list.topics.length, totalBytes }
}
