import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PROBE_TEMPLATE_PATH } from '../../packages/dsh-bridge/adapters/unity/probe.template.mjs'

// BUG-001：instance.json 的 bootId 指向不存在的通道目录。
//
// 现场是「身份字段全对、目录却不存在」：LoadOrCreateIdentity 只比对 pid/startTicks/
// bootId/nonce 就复用 bootId，从不校验 <root>/<bootId>/ 是否真的在；随后每次域重载
// 都命中复用分支，故障被固化，心跳照常刷新，调用方却持续收到 bridge mailbox missing。
//
// 这里锁定修复必须同时具备的两个不变量：
//   1. 复用 bootId 前校验通道目录齐全，不齐全就换新 bootId；
//   2. 心跳发布 instance.json 之前保证目录存在（自愈）。
// 只检查源码形态——行为正确性由 capability-semantics 的真实驱动用例负责。

const source = await readFile(PROBE_TEMPLATE_PATH, 'utf8')

/** 取出某个方法的函数体（按大括号配平），避免跨方法误匹配。 */
function bodyOf(name) {
  const start = source.indexOf(`static void ${name}(`)
  const alt = source.indexOf(`static bool ${name}(`)
  const from = start >= 0 ? start : alt
  assert.ok(from >= 0, `未找到方法 ${name}`)
  const open = source.indexOf('{', from)
  let depth = 0
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1
    else if (source[i] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(open, i + 1)
    }
  }
  throw new Error(`方法 ${name} 大括号不配平`)
}

test('BUG-001 复用 bootId 前校验通道目录齐全，不齐全则换新', () => {
  const body = bodyOf('LoadOrCreateIdentity')
  assert.match(body, /BootDirsComplete\(/, '复用分支必须校验目录齐全')
  assert.match(body, /BootDirsComplete\(reused\)/, '校验对象必须是即将复用的那个 bootId')

  // 校验必须发生在「把 reused 赋给 _bootId 并 return」之前。
  const checkAt = body.indexOf('BootDirsComplete(reused)')
  const returnAt = body.indexOf('return;', checkAt)
  const assignAt = body.lastIndexOf('_bootId = reused')
  assert.ok(assignAt > checkAt, '必须在校验之后才赋值')
  assert.ok(returnAt > assignAt, '必须在赋值之后才提前返回')
})

test('BUG-001 心跳发布 instance.json 之前自愈目录', () => {
  const body = bodyOf('WriteHeartbeat')
  assert.match(body, /EnsureBootDirs\(\)/, '心跳必须先保证目录存在')

  // 顺序约束：自愈必须在写 instance.json 之前。
  const ensureAt = body.indexOf('EnsureBootDirs()')
  const writeAt = body.indexOf('WriteAtomic(')
  assert.ok(writeAt > ensureAt, 'EnsureBootDirs 必须在写 instance.json 之前调用')
})

test('BUG-001 目录创建失败不再被静默吞掉', () => {
  const init = bodyOf('Init')
  assert.match(init, /if \(!EnsureBootDirs\(\)\)/, 'Init 必须检查目录创建结果')
  assert.match(init, /LogError/, '创建失败必须显式上报，不能只留下静默成功')
})

test('BUG-001 bootId 必须是安全目录名，不能只校验长度', () => {
  const body = bodyOf('IsValidBootId')
  // bootId 会被拼进 Path.Combine，instance.json 又是磁盘上可被改写的文件：
  // 仅长度校验挡不住 `..` 一类相对段。
  assert.match(body, /bootId\.Length != 16/)
  assert.match(body, />= '0' && c <= '9'/)
  assert.match(body, />= 'a' && c <= 'f'/)
})

test('BUG-001 清理逻辑用安全 bootId 判定，注释与实现一致', () => {
  const body = bodyOf('SweepStaleBootDirs')
  assert.match(body, /IsValidBootId\(name\)/, '清理必须用 IsValidBootId 而非裸长度判断')
  assert.equal(/name\.Length != 16/.test(body), false, '不应残留裸长度校验')

  // 注释曾写「保留当前 + 上一个」，实际是「当前 + mtime 最新的一个其他目录」。
  assert.match(source, /除当前通道目录外，只保留 mtime 最新的一个历史目录/)
})

test('BUG-001 复用与自愈不会泄漏 _bootId 目录前缀', () => {
  // 回归保护：所有子目录都必须挂在 <root>/<bootId> 之下，不能出现直接写 _rootDir 子目录的通道。
  for (const field of ['_inboxDir', '_outboxDir', '_eventsDir', '_doneDir', '_progressDir']) {
    assert.match(
      source,
      new RegExp(`${field} = Path\\.Combine\\(_rootDir, _bootId,`),
      `${field} 必须挂在 _bootId 下`,
    )
  }
})
