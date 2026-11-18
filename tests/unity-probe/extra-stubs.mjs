// 域级 stub 收集器：tests/unity-probe/stubs/*.cs 与主 stub 一起编译。
//
// 背景（v0.0.10 能力补齐）：图形 / 物理 / UI Toolkit / 输入 / 文档域会引入主 stub 未覆盖的
// Unity API。若所有域都往 unity-stubs.cs 里追加，多人并行开发必然互相踩踏；因此按域放在
// stubs/<domain>.cs，由编译器作为独立源文件一起编译。约定：
//   1. 只能定义主 stub（unity-stubs.cs / semantics-stubs.cs）未定义的类型，重复定义会 CS0101。
//   2. 只写探针直接引用的最小 API 面；包类型（URP/InputSystem 等）应走反射，不进 stub。
import { readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

/** @returns {Promise<{dir: string, files: string[]}>} 按文件名排序，保证编译输入稳定。 */
export async function collectExtraStubs() {
  const dir = join(here, 'stubs')
  let entries = []
  try {
    entries = await readdir(dir)
  } catch {
    return { dir, files: [] }
  }
  return {
    dir,
    files: entries.filter((name) => name.endsWith('.cs')).sort().map((name) => join(dir, name)),
  }
}
