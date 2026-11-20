// 预植入：在没有运行实例时扫描工程并提前写好探针包。
import { parse, resolve } from 'node:path'
import { PolicyError } from '../safety/policy.mjs'

/** 扫描深度上限：再深只会放大耗时，不会多找到工程（默认 3 已覆盖常见布局）。 */
const MAX_SCAN_DEPTH = 10

/**
 * roots 来自调用方（模型），必须当作不可信输入：拒绝文件系统根与空项，
 * 否则一次 apply 会尝试遍历整块磁盘（AA-TRUST-006）。
 */
function assertSafeRoots(roots) {
  if (roots === undefined || roots === null) return
  if (!Array.isArray(roots)) throw new PolicyError('invalid_argument', 'roots 必须是字符串数组')
  for (const root of roots) {
    if (typeof root !== 'string' || root.trim() === '') {
      throw new PolicyError('invalid_argument', 'roots 每项必须是非空字符串')
    }
    const resolved = resolve(root)
    if (resolved === parse(resolved).root) {
      throw new PolicyError('invalid_argument', `拒绝把文件系统根目录作为扫描根：${root}`)
    }
  }
}

/**
 * 扫描工程目录并提前写好探针。
 * - 默认只预览（apply=false）。
 * - 正在运行的工程默认跳过，避免批量抢焦点。
 */
export async function preinstallProjects(bridge, {
  apply = false,
  roots,
  maxDepth = 3,
  skipRunning = true,
  adapterId = 'unity',
} = {}) {
  const adapter = bridge.adapters.get(adapterId)
  if (!adapter) {
    throw new PolicyError('capability_unsupported', `适配器 ${adapterId} 未加载`)
  }
  // 可选成员判定读注册期能力表（P3-59）：以前这里写 typeof adapter.scan，缺成员时只报一句笼统的
  // 「不支持工程扫描」，既不知道缺哪些、也无从判断是「没实现」还是「实现错了」。
  const features = typeof bridge.featuresOf === 'function' ? bridge.featuresOf(adapter) : null
  const supports = (key) => (features ? features.has(key) : typeof adapter[key] === 'function')
  if (!supports('scan')) {
    throw new PolicyError(
      'capability_unsupported',
      `适配器 ${adapterId} 未实现工程扫描（adapter.scan），无法预植入`
        + (features ? `；该适配器未实现的成员：${features.missing.join(', ') || '无'}` : ''),
      { adapterId, missing: features ? [...features.missing] : [] },
    )
  }
  assertSafeRoots(roots)
  const depth = Math.min(MAX_SCAN_DEPTH, Math.max(1, Number.isFinite(Number(maxDepth)) ? Math.floor(Number(maxDepth)) : 3))
  const projects = await adapter.scan({ roots, maxDepth: depth })
  // 适配器违约（返回非数组）不能折叠成「扫描到 0 个工程」：那会让用户以为本机真的没有工程。
  if (!Array.isArray(projects)) {
    throw new PolicyError(
      'adapter_invalid',
      `适配器 ${adapterId} 的 scan 必须返回工程数组，实际返回 ${projects === null ? 'null' : typeof projects}`,
      { adapterId },
    )
  }
  const running = new Set((await bridge.targets()).map((instance) => instance.projectPath))

  const candidates = []
  for (const project of projects) {
    // 逐项过滤非法条目：批量操作里一条畸形结果不该让整批失败，但也绝不能变成一条空 projectPath 的候选。
    if (!project || typeof project.projectPath !== 'string' || project.projectPath === '') continue
    candidates.push({
      projectPath: project.projectPath,
      version: project.version ?? null,
      running: running.has(project.projectPath),
      // 缺 isInstalled 时按「未知」处理而不是静默当成「未安装」（那会把已安装工程重复纳入 pending）。
      installed: supports('isInstalled')
        ? await adapter.isInstalled(project.projectPath).catch(() => false)
        : null,
    })
  }

  if (!apply) {
    await bridge.audit.record({ event: 'preinstall', apply: false, scanned: candidates.length })
    return {
      apply: false,
      scanned: candidates.length,
      pending: candidates.filter((item) => item.installed !== true && !(skipRunning && item.running)),
      candidates,
      note: '只预览；传 apply=true 才会写入。运行中的工程默认跳过。',
    }
  }

  const applied = []
  const skipped = []
  const failed = []
  // 工作区隔离（P2-49）：配置了 bridge.projectScope 时，批量写盘不得越过白名单。
  const scope = Array.isArray(bridge.projectScope) && bridge.projectScope.length > 0 ? bridge.projectScope : null
  for (const item of candidates) {
    // 已安装不跳过：installStandalone 幂等，内容变化时负责升级。

    if (scope && !scope.includes(item.projectPath)) {
      skipped.push({ ...item, reason: 'out_of_scope' })
      continue
    }
    if (skipRunning && item.running) {
      skipped.push({ ...item, reason: 'running' })
      continue
    }
    if (!supports('installStandalone')) {
      skipped.push({ ...item, reason: 'adapter_unsupported_standalone_install' })
      continue
    }
    // 逐项隔离（P2-33）：第 N 个工程写盘失败（权限/磁盘满/符号链接拒绝）不得中断整批，
    // 否则此前已落盘的工程结果与成功审计全部丢失，调用方也无法判断「哪些已完成」。
    try {
      // 与 bridge.install 保持同一份授权/硬拒绝快照（AA-SEC-005）：只传 allowDangerous 会让
      // 预植入出的探针丢失 _deniedCapabilities，bridge.denied 表达的「本项目根本不允许」在该路径失效。
      const result = await adapter.installStandalone(item.projectPath, {
        allowDangerous: bridge.allowDangerous,
        denied: bridge.denied,
      })
      applied.push({
        projectPath: item.projectPath,
        version: item.version,
        changed: result.changed,
        exclude: result.exclude?.supported ? (result.exclude.changed ? 'added' : 'present') : 'not_git',
      })
      await bridge.audit.record({ event: 'preinstall', projectPath: item.projectPath, changed: result.changed })
    } catch (error) {
      const failure = {
        projectPath: item.projectPath,
        version: item.version,
        code: error?.code ?? 'install_failed',
        message: error?.message ?? String(error),
      }
      failed.push(failure)
      // 失败项同样留痕：否则「这次 apply 到底动过哪些工程」在审计里是空白。
      await bridge.audit.record({
        event: 'preinstall', ok: false, projectPath: item.projectPath, code: failure.code, message: failure.message,
      })
    }
  }
  await bridge.audit.record({
    event: 'preinstall',
    apply: true,
    scanned: candidates.length,
    applied: applied.length,
    skipped: skipped.length,
    failed: failed.length,
  })
  // 一项都没写成功时才算整体失败：部分成功必须如实返回，而不是抛一条笼统异常。
  if (applied.length === 0 && failed.length > 0) {
    throw new PolicyError(
      'preinstall_failed',
      `预植入全部失败（${failed.length} 个工程）：${failed.map((item) => `${item.projectPath} → ${item.code}`).join('；')}`,
      { scanned: candidates.length, failed },
    )
  }
  return { apply: true, scanned: candidates.length, applied, skipped, failed }
}
