// Unity 探针模板加载器。C# 源码保存在 probe/DSHBridgeProbe.cs.tpl，
// 以免把大段目标语言源码混进插件逻辑；加载时只替换版本号占位符。
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

/** 渲染探针源码；版本号写入常量，便于 DSH 侧检测漂移。 */
export function renderProbe({ probeVersion = '1' } = {}) {
  return template().replaceAll('__PROBE_VERSION__', String(probeVersion))
}
