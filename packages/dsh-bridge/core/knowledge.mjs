// 主题知识库：把「某个功能的实现方案」落成可复用的本地文档。
// 只存结论，不存全工程清单；文件位于 DSH 侧，不进目标工程。
import { createHash, randomBytes } from 'node:crypto'
import { logEvent } from '../safety/policy.mjs'
import { mkdir, open, readFile, readdir, rename, rm, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { PolicyError, assertInside } from '../safety/policy.mjs'

/** 单篇知识文档上限：避免一次调用把超大内容写进 ~/.dsh（与 args_json 1 MiB 口径一致）。 */
const MAX_KNOWLEDGE_BYTES = 1024 * 1024

/** 列表只需要 front matter；头部超过这个长度就按文件名兜底，不为列表整篇读入正文。 */
const FRONT_MATTER_BYTES = 4096

export function knowledgeRoot(instanceId) {
  let safe = String(instanceId ?? 'unknown').replace(/[^a-zA-Z0-9._-]/g, '_')
  // 白名单保留了 '.'，所以 '..' / '.' / 空串会被 join 解析到知识库上一级，
  // 必须显式收敛成固定目录名（P3-109）。
  if (!safe || safe === '.' || safe === '..') safe = 'unknown'
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

/** 主题的稳定短哈希：只用于把无法 slug 化或同名的主题区分成不同文件。 */
function topicHash(topic) {
  return createHash('sha1').update(String(topic ?? '')).digest('hex').slice(0, 8)
}

/**
 * front matter 单行值：把换行与不可打印控制字符压平。
 * 旧实现只对 summary 压平，topic/instance 未处理，于是含 \n 的主题能插入伪造的
 * updated/summary 行，污染 listTopics 的解析结果（P3-86）。
 */
function oneLine(value) {
  return String(value ?? '')
    .replace(/[\r\n\u2028\u2029]+/g, ' ')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
    .trim()
}

export function slugify(topic) {
  const raw = String(topic ?? '').normalize('NFC').trim().toLowerCase()
  const base = raw
    .replace(/[\s/\\]+/g, '-')
    // 保留全部 Unicode 字母与数字（中文/韩文/西里尔…），只丢标点与符号。
    // 旧白名单只有 ASCII + \u4e00-\u9fa5，韩文/俄文/emoji 主题全被清空（P2-19）。
    .replace(/[^\p{L}\p{N}._-]/gu, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
  // 纯 emoji/纯标点拿不到任何字符时用主题哈希，而不是公共常量 'topic'：
  // 否则所有这类主题共享 topic.md 并静默互相覆盖（P2-19）。
  return base || `topic-${topicHash(topic)}`
}

/**
 * 确保最终路径仍在 topics 目录内。判定收敛到 safety/policy.mjs 的权威 assertInside：
 * 本文件旧实现自己写了一份前缀比较，且把 target === root 判成合法，与 policy 语义相反（P3-90）。
 */
function assertInsideTopics(dir, file) {
  try {
    return assertInside(dir, file)
  } catch (error) {
    if (error instanceof PolicyError && error.code === 'path_escape') {
      throw Object.assign(new Error(`知识库路径越界：${file}`), { code: 'path_escape' })
    }
    throw error
  }
}

/** 目录项 fsync：让 rename 结果真正落盘，而不是只落文件数据。 */
async function syncDir(dir) {
  let handle = null
  try {
    handle = await open(dir, 'r')
    await handle.sync()
  } catch {
    // Windows 等平台不允许对目录 open/sync，退化为「文件已 fsync」，不影响写入原子性。
  } finally {
    await handle?.close().catch((error) => logEvent('debug', 'cleanup_failed', { code: error?.code ?? null }))
  }
}

/**
 * 原子写。与 transport/mailbox.mjs 的同名函数保持同一语义（P3-91）：
 * - 临时名带 pid + 随机段，同进程并发写同一主题不会共用同一个 .tmp（P2-29/P3-66）；
 * - 0600 落盘并 fsync 后才 rename，断电不留半截文件；
 * - 任一步失败即清掉临时文件，不在目录里留永久 .tmp（P3-118）；
 * - rename 成功后对父目录 sync，让目录项也落盘。
 */
async function writeAtomic(path, text) {
  const tmp = `${path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
  try {
    const handle = await open(tmp, 'w', 0o600)
    try {
      await handle.writeFile(text, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(tmp, path)
  } catch (error) {
    await rm(tmp, { force: true }).catch((error) => logEvent('debug', 'cleanup_failed', { code: error?.code ?? null }))
    throw error
  }
  await syncDir(dirname(path))
}

/** 只读文件头部：列表只为取 front matter 三行，不能顺带把最大 1 MiB 的正文读进内存（P3-108/P3-120）。 */
async function readFrontMatter(file) {
  let handle = null
  try {
    handle = await open(file, 'r')
    const buffer = Buffer.alloc(FRONT_MATTER_BYTES)
    const { bytesRead } = await handle.read(buffer, 0, FRONT_MATTER_BYTES, 0)
    return buffer.subarray(0, bytesRead).toString('utf8')
  } catch {
    return ''
  } finally {
    await handle?.close().catch((error) => logEvent('debug', 'cleanup_failed', { code: error?.code ?? null }))
  }
}

/** 截取 front matter 区块（首个 --- 与下一个 --- 之间），避免正文里的同名行被误当头部字段。 */
function frontMatterBlock(text) {
  if (!text.startsWith('---')) return ''
  const end = text.indexOf('\n---', 3)
  return end === -1 ? '' : text.slice(0, end)
}

/** 从 front matter 区块解析三个单行字段；缺失即 null。 */
function frontMatterFields(block) {
  return {
    topic: /^topic:\s*(.+)$/m.exec(block)?.[1]?.trim() ?? null,
    updated: /^updated:\s*(.+)$/m.exec(block)?.[1]?.trim() ?? null,
    summary: /^summary:\s*(.+)$/m.exec(block)?.[1]?.trim() ?? null,
  }
}

/** 读已存在文件里记录的主题，用于判断某个文件名是否已被另一个主题占用。 */
async function existingTopicOf(file) {
  return frontMatterFields(frontMatterBlock(await readFrontMatter(file))).topic
}

/**
 * 决定落盘文件名，绝不静默覆盖另一个主题（P2-19）：
 * 同一主题 → 覆盖更新（原有语义）；不同主题撞名 → 退到 `slug-<hash8>`；
 * 该名字也被别的主题占用（哈希碰撞/历史遗留）→ 报 topic_conflict，让调用方换主题名。
 */
async function resolveTopicFile(dir, slug, topic) {
  const title = oneLine(topic)
  const primary = assertInsideTopics(dir, join(dir, `${safeTopicName(slug)}.md`))
  const primaryTopic = await existingTopicOf(primary)
  if (!primaryTopic || primaryTopic === title) return primary
  const altSlug = `${slug.slice(0, 71)}-${topicHash(topic)}`
  const alt = assertInsideTopics(dir, join(dir, `${safeTopicName(altSlug)}.md`))
  const altTopic = await existingTopicOf(alt)
  if (!altTopic || altTopic === title) return alt
  throw Object.assign(
    new Error(`主题文件名冲突：${slug} 已被「${primaryTopic}」占用，请换一个主题名`),
    { code: 'topic_conflict' },
  )
}

/** 保存一个主题知识文档；同主题覆盖更新。 */
export async function saveTopic(instanceId, { topic, content, sources = [], summary = '' }) {
  if (!oneLine(topic)) throw Object.assign(new Error('缺少 topic'), { code: 'invalid_argument' })
  if (!content) throw Object.assign(new Error('缺少 content'), { code: 'invalid_argument' })
  const contentBytes = Buffer.byteLength(content, 'utf8')
  if (contentBytes > MAX_KNOWLEDGE_BYTES) {
    throw Object.assign(
      new Error(`content 过大（${contentBytes} 字节，上限 ${MAX_KNOWLEDGE_BYTES}）；请拆分主题`),
      { code: 'content_too_large' },
    )
  }
  const root = knowledgeRoot(instanceId)
  const dir = join(root, 'topics')
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const slug = slugify(topic)
  const file = await resolveTopicFile(dir, slug, topic)
  // 落盘时回填实际文件名派生的 slug：撞名退让后 slug 必须与磁盘一致，否则读/删定位不到。
  const fileSlug = basename(file, '.md')
  const createdAt = new Date().toISOString()
  const header = [
    '---',
    `topic: ${oneLine(topic)}`,
    `instance: ${oneLine(instanceId)}`,
    `updated: ${createdAt}`,
    summary ? `summary: ${oneLine(summary)}` : null,
    '---',
    '',
  ].filter(Boolean).join('\n')
  const sourceBlock = sources.length > 0
    ? `\n\n## 来源\n${sources.map((item) => `- \`${item}\``).join('\n')}\n`
    : '\n'
  const body = `${header}${content.trim()}\n${sourceBlock}`
  await writeAtomic(assertInsideTopics(dir, file), body)
  return { path: file, slug: fileSlug, topic, bytes: Buffer.byteLength(body, 'utf8'), updated: createdAt }
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
    const fields = frontMatterFields(frontMatterBlock(await readFrontMatter(file)))
    const fallback = name.replace(/\.md$/, '')
    topics.push({
      slug: fallback,
      topic: fields.topic ?? fallback,
      summary: fields.summary,
      updated: fields.updated,
    })
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
  const title = oneLine(slugOrTopic)
  const slug = slugify(slugOrTopic)
  const match = list.topics.find((item) => item.topic === title || item.slug === slug)
  if (!match) return null
  const file = join(dir, `${match.slug}.md`)
  return { path: file, content: await readFile(file, 'utf8') }
}

async function existsFile(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/** 删除一个主题；slug 或标题都可（与 readTopic 相同的定位语义）。 */
export async function removeTopic(instanceId, slugOrTopic) {
  const dir = join(knowledgeRoot(instanceId), 'topics')
  const direct = join(dir, `${safeTopicName(slugOrTopic)}.md`)
  if (await existsFile(direct)) {
    await rm(assertInsideTopics(dir, direct))
    return true
  }
  // 回退：按标题匹配。saveTopic 用 slugify(topic) 落盘，含全角括号/空格的主题
  // 只有文件头保留原文标题，直接用原文拼文件名会静默删不掉（BUG-0002）。
  const list = await listTopics(instanceId)
  const title = oneLine(slugOrTopic)
  const slug = slugify(slugOrTopic)
  const match = list.topics.find((item) => item.topic === title || item.slug === slug)
  if (!match) return false
  const file = join(dir, `${match.slug}.md`)
  if (!(await existsFile(file))) return false
  await rm(assertInsideTopics(dir, file))
  return true
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
