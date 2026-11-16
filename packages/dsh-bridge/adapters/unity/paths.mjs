// 探针的工程内位置：作为 embedded package 放在 Packages/ 下。
// 好处：Project 窗口不显示、Package Manager 可用 hideInEditor 隐藏、仍会被编译。
import { join } from 'node:path'
import { assertInside } from '../../safety/policy.mjs'

export const PACKAGE_NAME = 'com.dsh.bridge'
export const PACKAGE_RELATIVE_DIR = `Packages/${PACKAGE_NAME}`
export const PROBE_FILE_NAME = 'DSHBridgeProbe.cs'

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
    unity: '2019.4',
    hideInEditor: true,
    description: 'Local-only editor probe installed by DSH-Bridge. Safe to delete.',
    author: { name: 'DSH' },
  }, null, 2)}\n`
}
