// G3-cli 回归：bridge-cli 收敛到 Bridge 授权链、denied 快照继承、数值 flag 校验、--help/--dry-run。
//
// 对应发现：
//   P1-2 / P2-8 / P2-22 / P2-43 —— CLI 不再手抄授权链，改走 Bridge.call（denied/authorize/
//   probeOutdated/能力声明/审计 fail-closed 与插件一致；审计行带 via:"cli"）；
//   P1-3 —— inspectProject 必须映射 deniedCapabilities、nonce、probeOutdated；
//   P2-20 / P3-73 —— 非数值/缺值/越界 timeout 必须报错，不能得到 NaN deadline；
//   P2-46 —— --help 打印用法、--dry-run 不写盘、未知 flag 报错；
//   P3-79 —— args_json 复用 tools/args.mjs 的契约。
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'

import { unityAdapter } from '../../packages/dsh-bridge/adapters/unity/index.mjs'
import {
  callCapability, inspectProject, instanceFromView, main, numberFlag, parseArgs, resolveAuthConfig,
} from '../../scripts/bridge-cli.mjs'

const touchedEnv = []
function setEnv(name, value) {
  touchedEnv.push(name)
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

afterEach(() => {
  while (touchedEnv.length > 0) delete process.env[touchedEnv.pop()]
})

/** 捕获 stdout：main() 会直接写进程输出，测试里需要静音并断言内容。 */
async function captureStdout(fn) {
  const original = process.stdout.write
  const chunks = []
  process.stdout.write = (chunk) => {
    chunks.push(String(chunk))
    return true
  }
  try {
    const value = await fn()
    return { value, output: chunks.join('') }
  } finally {
    process.stdout.write = original
  }
}

/** 造一个「心跳陈旧但进程仍在」的工程：status=idle，不触发通道目录检查。 */
async function makeIdleProject({ capabilities = ['unity.editor.status'], denied = [], probeVersion } = {}) {
  const projectPath = await mkdtemp(join(tmpdir(), 'g3-cli-'))
  await mkdir(join(projectPath, 'Library', 'DSHBridge'), { recursive: true })
  await writeFile(join(projectPath, 'Library', 'DSHBridge', 'instance.json'), JSON.stringify({
    instanceId: 'unity:g3test',
    bootId: 'a'.repeat(16),
    nonce: 'b'.repeat(32),
    pid: process.pid,
    probeVersion: probeVersion ?? unityAdapter.probeVersion,
    // 60s 前的心跳 + 存活 pid → status=idle（可唤醒），且跳过通道目录检查。
    lastSeenAt: new Date(Date.now() - 60000).toISOString(),
    capabilities,
    grantedCapabilities: [],
    deniedCapabilities: denied,
  }), 'utf8')
  return projectPath
}

/** 调用期间替换 unityAdapter.detect：避免测试依赖机器上真实的 Unity 进程。 */
async function withEngineProcesses(candidates, fn) {
  const original = unityAdapter.detect
  unityAdapter.detect = async () => candidates
  try {
    return await fn()
  } finally {
    unityAdapter.detect = original
  }
}

test('P1-2：CLI 授权配置读与插件同名的 DSH_BRIDGE_DANGEROUS/DENIED 环境变量', () => {
  setEnv('DSH_BRIDGE_DANGEROUS', 'unity.code.execute')
  setEnv('DSH_BRIDGE_DENIED', 'unity.asset.delete')
  setEnv('DSH_BRIDGE_ALLOW_DANGEROUS', 'unity.menu.execute')
  const auth = resolveAuthConfig({ allowDangerous: ['unity.package.add'] })
  // dangerous 是「在 DEFAULT_DANGEROUS 之上追加」：unity.code.execute 因此从默认开启变成需授权。
  assert.ok(auth.dangerous.includes('unity.code.execute'))
  assert.ok(auth.dangerous.includes('unity.reflect.invoke'))
  assert.deepEqual(auth.denied, ['unity.asset.delete'])
  // flag 与 env 取并集：flag 只能加不能减。
  assert.ok(auth.allowDangerous.includes('unity.menu.execute'))
  assert.ok(auth.allowDangerous.includes('unity.package.add'))
})

test('P1-3：inspectProject 映射 deniedCapabilities/nonce/probeOutdated', async () => {
  const projectPath = await makeIdleProject({
    capabilities: ['unity.editor.status'],
    denied: ['unity.asset.delete'],
  })
  try {
    const view = await inspectProject(projectPath)
    assert.equal(view.status, 'idle')
    assert.deepEqual(view.deniedCapabilities, ['unity.asset.delete'])
    assert.equal(typeof view.nonce, 'string')
    assert.equal(view.adapterId, 'unity')
    assert.equal(view.expectedProbeVersion, unityAdapter.probeVersion)
    assert.equal(view.probeOutdated, false)

    const stale = await inspectProject(await makeIdleProject({ probeVersion: 'v-old' }))
    assert.equal(stale.probeOutdated, true)
  } finally {
    await rm(projectPath, { recursive: true, force: true })
  }
})

test('P2-8/P2-22/P2-43：callCapability 走 Bridge 的 denied 硬拒绝并写 via:"cli" 审计', async () => {
  const projectPath = await makeIdleProject({
    capabilities: ['unity.editor.status'],
    denied: ['unity.editor.status'],
  })
  const auditDir = await mkdtemp(join(tmpdir(), 'g3-cli-audit-'))
  setEnv('DSH_BRIDGE_AUDIT', join(auditDir, 'audit.log'))
  try {
    const view = await inspectProject(projectPath)
    const error = await withEngineProcesses([], () => callCapability(view, 'unity.editor.status', {}, { timeoutMs: 1000 }))
      .then(() => null, (err) => err)
    assert.ok(error, 'denied 快照命中的能力必须被拒绝')
    assert.equal(error.code, 'capability_denied')
    const log = await readFile(join(auditDir, 'audit.log'), 'utf8')
    assert.match(log, /"via":"cli"/)
    assert.match(log, /capability_denied/)
  } finally {
    await rm(projectPath, { recursive: true, force: true })
    await rm(auditDir, { recursive: true, force: true })
  }
})

test('P2-8：同工程双编辑器时 CLI 拒绝下发指令（instance_ambiguous）', async () => {
  const projectPath = await makeIdleProject({ capabilities: ['unity.editor.status'] })
  const auditDir = await mkdtemp(join(tmpdir(), 'g3-cli-audit-'))
  setEnv('DSH_BRIDGE_AUDIT', join(auditDir, 'audit.log'))
  try {
    const view = await inspectProject(projectPath)
    const canonical = await realpath(projectPath)
    const error = await withEngineProcesses([
      { adapterId: 'unity', instanceId: view.instanceId, pid: process.pid, projectPath: canonical },
      { adapterId: 'unity', instanceId: view.instanceId, pid: process.pid + 1, projectPath: canonical },
    ], () => callCapability(view, 'unity.editor.status', {}, { timeoutMs: 1000 }))
      .then(() => null, (err) => err)
    assert.ok(error, '同工程多编辑器必须拒绝下发')
    assert.equal(error.code, 'instance_ambiguous')
  } finally {
    await rm(projectPath, { recursive: true, force: true })
    await rm(auditDir, { recursive: true, force: true })
  }
})

test('P1-2：callCapability 不再绕过能力声明校验（Bridge 的 capability_unsupported）', async () => {
  const projectPath = await makeIdleProject({ capabilities: ['unity.asset.delete'] })
  const auditDir = await mkdtemp(join(tmpdir(), 'g3-cli-audit-'))
  setEnv('DSH_BRIDGE_AUDIT', join(auditDir, 'audit.log'))
  try {
    const view = await inspectProject(projectPath)
    const error = await withEngineProcesses([], () => callCapability(view, 'unity.editor.status', {}, { timeoutMs: 1000 }))
      .then(() => null, (err) => err)
    assert.ok(error, '未声明的能力必须被拒绝')
    assert.equal(error.code, 'capability_unsupported')
  } finally {
    await rm(projectPath, { recursive: true, force: true })
    await rm(auditDir, { recursive: true, force: true })
  }
})

test('P2-8：instanceFromView 用工程哈希兜底 instanceId，并补齐 Bridge 需要的字段', () => {
  const instance = instanceFromView({ projectPath: '/tmp/whatever', status: 'idle' })
  assert.match(instance.instanceId, /^unity:[0-9a-f]{12}$/)
  assert.equal(instance.adapterId, 'unity')
  assert.equal(instance.pidMismatch, false)
  assert.equal(instance.expectedProbeVersion, unityAdapter.probeVersion)
  assert.deepEqual(instance.deniedCapabilities, [])
})

test('P2-20/P3-73：数值 flag 非法值报错，不再产生 NaN deadline', () => {
  assert.equal(numberFlag({}, 'timeout', 30000), 30000)
  assert.equal(numberFlag({ timeout: '5000' }, 'timeout', 30000), 5000)
  assert.throws(() => numberFlag({ timeout: 'abc' }, 'timeout', 30000), /之间的数值/)
  // parseArgs 把缺值 flag 记成 true；Number(true)===1 会让调用 1ms 就超时，必须显式拒绝。
  assert.throws(() => numberFlag({ timeout: true }, 'timeout', 30000), /缺少值/)
  assert.throws(() => numberFlag({ timeout: '50' }, 'timeout', 30000, { min: 100, max: 600000 }), /期望 100-600000/)
  assert.throws(() => numberFlag({ timeout: '999999' }, 'timeout', 30000, { min: 100, max: 600000 }), /期望 100-600000/)
  assert.equal(numberFlag({ 'max-depth': '10' }, 'max-depth', 3, { min: 1, max: 10 }), 10)
})

test('P2-46：未知 flag 被拒绝而不是静默忽略', () => {
  assert.throws(() => parseArgs(['discover', '--typo']), /未知参数 --typo/)
  // 值型 flag 拼错（--timeoutt）同样必须报错，否则会被静默忽略并沿用默认超时。
  assert.throws(() => parseArgs(['discover', '--timeoutt', 'abc']), /未知参数 --timeoutt/)
  // 合法 flag 仍然解析：布尔型不带值，值型吃下一个 token。
  const { positional, flags } = parseArgs(['install', '/p', '--dry-run', '--wait', '5000', '--yes'])
  assert.deepEqual(positional, ['install', '/p'])
  assert.equal(flags['dry-run'], true)
  assert.equal(flags.wait, '5000')
  assert.equal(flags.yes, true)
})

test('P2-46：--help 打印用法且不触发 discover 扫描', async () => {
  const original = unityAdapter.scan
  let scanned = false
  unityAdapter.scan = async () => {
    scanned = true
    return []
  }
  try {
    const { value, output } = await captureStdout(() => main(['--help']))
    assert.equal(value, 0)
    assert.match(output, /用法：/)
    assert.match(output, /--dry-run/)
    assert.equal(scanned, false, '--help 不能回落到 discover')
  } finally {
    unityAdapter.scan = original
  }
})

test('P2-46：install --dry-run 只预览，不写探针包也不激活编辑器', async () => {
  const projectPath = await mkdtemp(join(tmpdir(), 'g3-cli-dry-'))
  const auditDir = await mkdtemp(join(tmpdir(), 'g3-cli-audit-'))
  await mkdir(join(projectPath, 'Assets'), { recursive: true })
  setEnv('DSH_BRIDGE_AUDIT', join(auditDir, 'audit.log'))
  try {
    const { value, output } = await captureStdout(() => main(['install', projectPath, '--dry-run']))
    assert.equal(value, 0)
    const result = JSON.parse(output)
    assert.equal(result.dryRun, true)
    assert.equal(existsSync(join(projectPath, 'Packages', 'com.dsh.bridge')), false, 'dry-run 不能写盘')
    const log = await readFile(join(auditDir, 'audit.log'), 'utf8')
    assert.match(log, /"dryRun":true/)
  } finally {
    await rm(projectPath, { recursive: true, force: true })
    await rm(auditDir, { recursive: true, force: true })
  }
})

test('P1-3：install 在解除已有硬拒绝时必须要求 --yes', async () => {
  const projectPath = await makeIdleProject({ denied: ['unity.asset.delete'] })
  const auditDir = await mkdtemp(join(tmpdir(), 'g3-cli-audit-'))
  setEnv('DSH_BRIDGE_AUDIT', join(auditDir, 'audit.log'))
  try {
    const error = await main(['install', projectPath, '--deny', '', '--dry-run'])
      .then(() => null, (err) => err)
    assert.ok(error, '清空 denied 必须被 --yes 门槛挡住')
    assert.equal(error.code, 'missing_yes')
    assert.match(error.message, /解除探针硬拒绝需要显式 --yes/)
  } finally {
    await rm(projectPath, { recursive: true, force: true })
    await rm(auditDir, { recursive: true, force: true })
  }
})

test('P2-43：审计不可写时高权能力在 CLI 上 fail-closed（不留零痕迹执行）', async () => {
  const projectPath = await makeIdleProject({ capabilities: ['unity.code.execute'] })
  // /dev/null 是字符设备，mkdir 其子路径必然 ENOTDIR：模拟「审计目录不可写」。
  setEnv('DSH_BRIDGE_AUDIT', '/dev/null/dsh-bridge-audit/audit.log')
  try {
    const view = await inspectProject(projectPath)
    const error = await withEngineProcesses([], () => callCapability(view, 'unity.code.execute', { code: 'return 1;' }, { timeoutMs: 1000 }))
      .then(() => null, (err) => err)
    assert.ok(error, '审计不可用时高权能力必须被拒绝')
    assert.equal(error.code, 'audit_unavailable')
    assert.match(error.message, /无法写入审计日志/)
  } finally {
    await rm(projectPath, { recursive: true, force: true })
  }
})

test('P3-79：call 的 args_json 与 DSH 工具共用同一份契约', async () => {
  const error = await main(['call', '/nonexistent-project', 'unity.editor.status', 'null'])
    .then(() => null, (err) => err)
  assert.ok(error)
  assert.equal(error.code, 'invalid_args')

  const tooLarge = '{"a":"' + 'x'.repeat(1024 * 1024 + 1) + '"}'
  const largeError = await main(['call', '/nonexistent-project', 'unity.editor.status', tooLarge])
    .then(() => null, (err) => err)
  assert.ok(largeError)
  assert.equal(largeError.code, 'args_too_large')
})
