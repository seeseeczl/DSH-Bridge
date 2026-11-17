// Unity 探针模板加载器。C# 源码保存在 probe/DSHBridgeProbe.cs.tpl，
// 以免把大段目标语言源码混进插件逻辑；加载时替换版本号与授权快照两个占位符。
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// 探针现在作为 embedded package 安装在 Packages/ 下（Project 窗口不可见）。
export const PROBE_RELATIVE_DIR = ['Packages', 'com.dsh.bridge', 'Editor']
export const PROBE_FILE_NAME = 'DSHBridgeProbe.cs'
export const PROBE_TEMPLATE_PATH = join(dirname(fileURLToPath(import.meta.url)), 'probe', 'DSHBridgeProbe.cs.tpl')

let cached = null

function template() {
  cached ??= readFileSync(PROBE_TEMPLATE_PATH, 'utf8')
  return cached
}

/** C# 字符串字面量：转义反斜杠、引号与控制字符，避免能力名注入破坏源码结构。 */
function csharpString(value) {
  const escaped = String(value)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')
  return `"${escaped}"`
}

/**
 * 渲染授权快照：`allowDangerous` 里的能力名被渲染成 C# 数组字面量。
 * 空列表渲染为 `(string)null` 之外的合法空数组——这里用 ` new string[0] ` 的等价写法。
 */
function renderSnapshot(allowDangerous) {
  const items = Array.from(new Set((allowDangerous ?? []).filter((item) => typeof item === 'string' && item)))
  if (items.length === 0) return ''
  return items.map(csharpString).join(', ')
}

/**
 * 渲染探针源码。
 * @param {{probeVersion?: string, allowDangerous?: string[]}} options
 *   probeVersion 写入常量便于 DSH 侧检测漂移；allowDangerous 决定反射执行面在探针侧的授权快照。
 */
export function renderProbe({ probeVersion = '1', allowDangerous = [], denied = [], sourceHash } = {}) {
  const base = template()
    .replaceAll('__PROBE_VERSION__', String(probeVersion))
    .replaceAll('__ALLOW_DANGEROUS__', renderSnapshot(allowDangerous))
    .replaceAll('__DENY_CAPABILITIES__', renderSnapshot(denied))
  // 哈希覆盖「除哈希本身之外」的最终内容，因此同一份渲染结果总是得到同一个值（幂等安装）。
  const hash = sourceHash
    ?? createHash('sha256').update(base.replaceAll('__SOURCE_HASH__', '')).digest('hex').slice(0, 16)
  return base.replaceAll('__SOURCE_HASH__', hash)
}
