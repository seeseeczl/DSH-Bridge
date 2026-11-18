// Unity 探针模板加载器。C# 源码按域拆成多个 partial class 模板（probe/*.tpl），
// 以免把大段目标语言源码混进插件逻辑；加载时替换版本号与授权快照两个占位符。
// 偿还 EXC-0001：单文件曾达 5951 LOC，拆成多文件后仍保持 embedded package 可整体删除。
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const probeDir = join(dirname(fileURLToPath(import.meta.url)), 'probe')

// 探针现在作为 embedded package 安装在 Packages/ 下（Project 窗口不可见）。
export const PROBE_RELATIVE_DIR = ['Packages', 'com.dsh.bridge', 'Editor']
export const PROBE_FILE_NAME = 'DSHBridgeProbe.cs'
export const PROBE_TEMPLATE_PATH = join(probeDir, 'DSHBridgeProbe.cs.tpl')

/**
 * 探针文件清单（顺序即写入与哈希顺序）。
 * 第一个是含 [InitializeOnLoad] 与 ProbeVersion/SourceHash 常量的入口文件，其余是按域拆分的 partial class。
 */
export const PROBE_TEMPLATE_FILES = Object.freeze([
  { file: 'DSHBridgeProbe.cs', template: 'DSHBridgeProbe.cs.tpl' },
  { file: 'DSHBridgeProbe.Security.cs', template: 'DSHBridgeProbe.Security.cs.tpl' },
  { file: 'DSHBridgeProbe.Capabilities.cs', template: 'DSHBridgeProbe.Capabilities.cs.tpl' },
  { file: 'DSHBridgeProbe.Scene.cs', template: 'DSHBridgeProbe.Scene.cs.tpl' },
  { file: 'DSHBridgeProbe.Assets.cs', template: 'DSHBridgeProbe.Assets.cs.tpl' },
  { file: 'DSHBridgeProbe.Jobs.cs', template: 'DSHBridgeProbe.Jobs.cs.tpl' },
  { file: 'DSHBridgeProbe.Domains.cs', template: 'DSHBridgeProbe.Domains.cs.tpl' },
  { file: 'DSHBridgeProbe.Execution.cs', template: 'DSHBridgeProbe.Execution.cs.tpl' },
  { file: 'DSHBridgeProbe.MonoCompiler.cs', template: 'DSHBridgeProbe.MonoCompiler.cs.tpl' },
])

export const PROBE_TEMPLATE_PATHS = Object.freeze(
  PROBE_TEMPLATE_FILES.map(({ template }) => join(probeDir, template)),
)

const cache = new Map()
function templateOf(name) {
  if (!cache.has(name)) cache.set(name, readFileSync(join(probeDir, name), 'utf8'))
  return cache.get(name)
}

/** 全部模板原文拼接（源码形态检查用：只回答「有没有这个机制」，不代表行为正确）。 */
export function readProbeTemplateText() {
  return PROBE_TEMPLATE_FILES.map(({ template }) => templateOf(template)).join('\n')
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
 * 空列表渲染为空字符串，让 C# 端得到空数组初始化。
 */
function renderSnapshot(allowDangerous) {
  const items = Array.from(new Set((allowDangerous ?? []).filter((item) => typeof item === 'string' && item)))
  if (items.length === 0) return ''
  return items.map(csharpString).join(', ')
}

function renderTemplate(name, { probeVersion, allowDangerous, denied }) {
  return templateOf(name)
    .replaceAll('__PROBE_VERSION__', String(probeVersion))
    .replaceAll('__ALLOW_DANGEROUS__', renderSnapshot(allowDangerous))
    .replaceAll('__DENY_CAPABILITIES__', renderSnapshot(denied))
}

/**
 * 渲染全部探针文件。
 * sourceHash 覆盖所有文件（文件名 + 内容），因此同一份渲染结果总是得到同一个值（幂等安装）；
 * 任一文件内容变化都会改变心跳里上报的 sourceHash。
 * @returns {{files: Array<{file: string, content: string, sha256: string}>, sourceHash: string}}
 */
export function renderProbeFiles({ probeVersion = '1', allowDangerous = [], denied = [], sourceHash } = {}) {
  const rendered = PROBE_TEMPLATE_FILES.map(({ file, template }) => ({
    file,
    content: renderTemplate(template, { probeVersion, allowDangerous, denied }),
  }))
  const hash = sourceHash
    ?? createHash('sha256')
      .update(PROBE_TEMPLATE_FILES.map(({ file }, i) => `${file}\n${rendered[i].content.replaceAll('__SOURCE_HASH__', '')}`).join('\n--\n'))
      .digest('hex')
      .slice(0, 16)
  return {
    files: rendered.map(({ file, content }) => {
      const finalContent = content.replaceAll('__SOURCE_HASH__', hash)
      return { file, content: finalContent, sha256: createHash('sha256').update(finalContent).digest('hex') }
    }),
    sourceHash: hash,
  }
}

/**
 * 渲染单个文件（默认入口文件）源码，保留给只需要主文件的调用方与旧测试。
 * @param {{probeVersion?: string, allowDangerous?: string[], denied?: string[], sourceHash?: string, file?: string}} options
 */
export function renderProbe({ probeVersion = '1', allowDangerous = [], denied = [], sourceHash, file = PROBE_FILE_NAME } = {}) {
  const { files } = renderProbeFiles({ probeVersion, allowDangerous, denied, sourceHash })
  const found = files.find((item) => item.file === file)
  if (!found) throw new Error(`未知探针文件: ${file}`)
  return found.content
}
