// 探针的工程内位置：作为 embedded package 放在 Packages/ 下。
// 好处：Project 窗口不显示、Package Manager 可用 hideInEditor 隐藏、仍会被编译。
import { join } from 'node:path'
import { assertInside } from '../../safety/policy.mjs'

export const PACKAGE_NAME = 'com.dsh.bridge'
export const PACKAGE_RELATIVE_DIR = `Packages/${PACKAGE_NAME}`
export const PROBE_FILE_NAME = 'DSHBridgeProbe.cs'

/**
 * 探针真实的最低引擎版本。
 * 不能沿用历史声明的 2019.4：DSHBridgeProbe.UiToolkit.cs.tpl 在方法签名与泛型参数里
 * **直接引用** UnityEngine.UIElements.UIDocument（2022.3 起的内置模块，见 tests/unity-probe/stubs/uitk.cs）。
 * 在更低版本上安装时，探针作为同一程序集的 partial class 会整体编译失败，让目标工程
 * 卡在「脚本编译错误」并禁止进入 Play Mode。声明真实下限后，Package Manager 会直接
 * 拒绝该包，而不是放行后编译坍塌；安装器也用同一常量做写盘前的版本闸门。
 */
export const MIN_ENGINE_VERSION = '2022.3'

export function packageDir(projectPath) {
  return assertInside(projectPath, join(projectPath, 'Packages', PACKAGE_NAME))
}

export function probeFile(projectPath) {
  return join(packageDir(projectPath), 'Editor', PROBE_FILE_NAME)
}

export function manifestFile(projectPath) {
  return join(packageDir(projectPath), 'package.json')
}

/** 旧版安装位置（Assets 下），仅用于迁移清理。 */
export function legacyDir(projectPath) {
  return join(projectPath, 'Assets', 'DSHBridge')
}

/** embedded package 的清单；hideInEditor 让它在 Package Manager 里也不出现。 */
export function packageManifest(probeVersion) {
  return `${JSON.stringify({
    name: PACKAGE_NAME,
    displayName: 'DSH Bridge Probe',
    version: `${probeVersion}.0.0`,
    unity: MIN_ENGINE_VERSION,
    hideInEditor: true,
    description: 'Local-only editor probe installed by DSH-Bridge. Safe to delete.',
    author: { name: 'DSH' },
  }, null, 2)}\n`
}
