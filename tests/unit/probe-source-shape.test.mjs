import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { renderProbeFiles, readProbeTemplateText } from '../../packages/dsh-bridge/adapters/unity/probe.template.mjs'

/** 渲染全部 partial 文件并拼接（跨文件断言用）。 */
const renderAll = (options) => renderProbeFiles(options).files.map((file) => file.content).join('\n')
import { UNITY_CAPABILITIES } from '../../packages/dsh-bridge/adapters/unity/index.mjs'
import { DEFAULT_DANGEROUS } from '../../packages/dsh-bridge/safety/policy.mjs'

// 探针源码形态检查（AA-OPT-013）。
//
// 这里只回答「探针源码里有没有这个机制」，**不证明行为正确**——行为由
// tests/unity-probe/capability-semantics.test.mjs 真实驱动验证。两者分工明确，
// 避免"源码包含某个字符串 = 功能正确"的假覆盖。
test('探针源码包含过期校验、编译状态与路径边界机制', async () => {
  const source = readProbeTemplateText()
  assert.match(source, /deadlineMs/, '必须读取 deadlineMs')
  assert.match(source, /issuedAt/, '必须读取 issuedAt')
  assert.match(source, /"expired"/, '过期请求必须返回 expired 错误码')
  assert.match(source, /ResolveProjectPath/, '必须存在统一的工程内路径解析')
  assert.match(source, /path_escape/, '越界路径必须返回 path_escape')
  assert.match(source, /capability_denied/, '危险能力必须可被探针侧拒绝')
  assert.match(source, /request_rejected/, '拒绝必须留下事件')
  assert.match(source, /in-progress|_progressDir/, '必须保留执行中状态以便识别 in_flight')
})

test('渲染结果替换版本号且保留关键契约', () => {
  const source = renderAll({ probeVersion: '9' })
  assert.match(source, /ProbeVersion = "9"/)
  assert.match(source, /class DSHBridgeProbe/)
  assert.match(source, /pairing_mismatch/)
  assert.match(source, /capability_unsupported/)
  assert.equal(source.includes('__PROBE_VERSION__'), false)
})

test('探针不引入监听端口或外部进程', () => {
  const source = renderAll({ probeVersion: '1' })
  assert.equal(/new TcpListener|HttpListener|Socket\(/.test(source), false, '探针不得监听端口')
  assert.equal(/Process\.Start\(/.test(source), false, '探针不得启动外部进程')
  assert.equal(/WebClient|HttpClient/.test(source), false, '探针不得访问网络')
})

// 能力补全第 1 项（视觉反馈）与第 7 项（菜单执行解禁）。
test('探针包含截图能力且落在 Library 产物目录', async () => {
  const source = readProbeTemplateText()
  assert.match(source, /unity\.screenshot\.capture/, '必须声明截图能力')
  assert.match(source, /ScreenshotCapture/, '必须有截图实现')
  assert.match(source, /EncodeToPNG/, '必须真正编码 PNG')
  assert.match(source, /artifacts/, '截图必须落在 Library/DSHBridge/artifacts')
})

test('菜单执行已从永久封禁解禁为可授权危险能力', async () => {
  const source = readProbeTemplateText()
  assert.equal(source.includes('unity.menu.execute 在探针侧永久关闭'), false, 'menu.execute 不应再被永久封禁')
  assert.match(source, /static readonly string\[\] _blockedCapabilities = new string\[\] \{\s*\};/, '永久封禁清单应为空')
  assert.match(source, /ExecuteMenuItem\(path\)/, '必须调用 EditorApplication.ExecuteMenuItem')
})

// 能力补全第 2 项（脚本精细编辑）。
test('探针包含脚本精细编辑能力（SHA 前置校验 + 行列 patch）', async () => {
  const source = readProbeTemplateText()
  assert.match(source, /unity\.script\.get_sha/)
  assert.match(source, /unity\.script\.apply_edits/)
  assert.match(source, /precondition_failed/, '必须支持 preconditionSha256 失败')
  assert.match(source, /edits_overlap/, '必须拒绝重叠编辑区间')
})

// 能力补全第 3/6 项（生产管线 + 长任务作业化）。
test('探针包含生产管线与作业体系', async () => {
  const source = readProbeTemplateText()
  assert.match(source, /unity\.build\.start/)
  assert.match(source, /unity\.job\.list/)
  assert.match(source, /unity\.job\.cancel/)
  assert.match(source, /unity\.package\.add/)
  assert.match(source, /unity\.bake\.lighting/)
  assert.match(source, /RecoverInterruptedJobs/, '域重载后必须恢复/标记作业')
  assert.match(source, /interrupted/, '未完成作业必须显式标记 interrupted')
  assert.match(source, /invalid_output_path/, '构建输出不得写进 Library')
})

// 能力补全补充：截图序列（录屏帧序列）与脚本编译校验。
test('探针包含截图序列与脚本编译校验', async () => {
  const source = readProbeTemplateText()
  assert.match(source, /unity\.screenshot\.sequence/)
  assert.match(source, /unity\.script\.validate/)
  assert.match(source, /ValidateCode/)
  assert.match(source, /CompileAssemblyFromSource/)
})

// 能力补全第 3 项补全：测试运行（动态编译桥接 TestRunnerApi）。
test('探针包含测试运行能力（动态编译桥接）', async () => {
  const source = readProbeTemplateText()
  assert.match(source, /unity\.test\.run/)
  assert.match(source, /TestRunnerApi/)
  assert.match(source, /test_framework_missing/)
  assert.match(source, /PollTestJobs/)
})

// 双侧能力清单一致性（真实漂移风险：探针 _capabilities 与 adapter UNITY_CAPABILITIES 手动维护）。
test('探针声明的能力集合与 UNITY_CAPABILITIES 完全一致', async () => {
  const source = readProbeTemplateText()
  const match = source.match(/_capabilities = new string\[\] \{([\s\S]*?)\};/)
  assert.ok(match, '找不到探针 _capabilities 数组')
  const probeCaps = [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort()
  const adapterCaps = [...UNITY_CAPABILITIES].sort()
  assert.deepEqual(probeCaps, adapterCaps, '探针与适配器能力清单漂移')
  assert.ok(adapterCaps.length >= 116, 'v27 能力面不应回退（116 项）')
})

// v27：危险能力闸门必须与 DSH 侧 DEFAULT_DANGEROUS 完全一致。
// 单侧漏加会让「DSH 默认关闭」变成假安全：绕过 DSH 直接写 inbox 就能执行。
test('探针危险能力闸门与 DEFAULT_DANGEROUS 完全一致（双向）', async () => {
  const source = readProbeTemplateText()
  const match = source.match(/_reflectCapabilities = new string\[\] \{([\s\S]*?)\};/)
  assert.ok(match, '找不到探针 _reflectCapabilities 数组')
  const probeDanger = [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort()
  const policyDanger = [...DEFAULT_DANGEROUS].sort()
  assert.deepEqual(probeDanger, policyDanger, '探针闸门与 policy.DEFAULT_DANGEROUS 漂移')
})

// 审计修复（AUD-CODE-001）：P0/P1/P2 关键机制必须在源码里可验证。
test('审计修复：MiniJson 深度/大小上限与 NaN 序列化', async () => {
  const source = readProbeTemplateText()
  assert.match(source, /MaxDepth/)
  assert.match(source, /MaxInputBytes/)
  assert.match(source, /IsNaN/)
  assert.match(source, /IsInfinity/)
})

test('审计修复：事件序号加锁、原子写、权限与通道诊断', async () => {
  const source = readProbeTemplateText()
  assert.match(source, /_eventLock/)
  assert.match(source, /NextEventFile/)
  assert.match(source, /File\.Replace/)
  assert.match(source, /TryFixPermissions/)
  assert.match(source, /AddChannelDiagnostic/)
  assert.match(source, /CodeOfExtended/)
})

test('审计修复：截图预算/编码处理/validate 判定', async () => {
  const source = readProbeTemplateText()
  assert.match(source, /plannedDurationMs/)
  assert.match(source, /ScreenshotSequenceBudgetMs/)
  assert.match(source, /invalid_encoding/)
  assert.match(source, /HasErrors/)
  assert.match(source, /CaptureScreenshotAsTexture/)
})

test('审计修复：写保护、输入注入交付标记与参数校验', async () => {
  const source = readProbeTemplateText()
  assert.match(source, /delivered/)
  assert.match(source, /ignored/)
  assert.match(source, /EventModifiers/)
})

test('审计修复：危险能力闸门扩展到全部危险能力（13 项）', async () => {
  const source = readProbeTemplateText()
  for (const capability of [
    'unity.menu.execute', 'unity.package.add', 'unity.package.remove',
    'unity.asset.delete', 'unity.asset.move', 'unity.asset.rename', 'unity.asset.duplicate',
    'unity.asset.refresh', 'unity.importer.set',
  ]) {
    assert.match(source, new RegExp(`_reflectCapabilities[\\s\\S]*${capability.replace(/\./g, '\\.')}`), `危险能力闸门缺少 ${capability}`)
  }
})

// v27：每个域一个分发器，且 Execute 必须调用全部六个；分发里的能力名必须都在声明的 116 项内。
test('v27 域分发器齐备、被 Execute 调用且不越出能力清单', async () => {
  const source = readProbeTemplateText()
  for (const domain of ['Graphics', 'Physics', 'UiToolkit', 'InputPlay', 'EditorMeta', 'Docs']) {
    assert.match(source, new RegExp(`static Dictionary<string, object> Try${domain}\\(string cap`), `缺少 Try${domain} 分发器`)
    assert.match(source, new RegExp(`domainResult = Try${domain}\\(cap, args\\)`), `Execute 未调用 Try${domain}`)
  }
  const dispatched = [...source.matchAll(/cap == "(unity\.[a-z0-9.]+)"/g)].map((m) => m[1])
  const unknown = [...new Set(dispatched)].filter((cap) => !UNITY_CAPABILITIES.includes(cap))
  assert.deepEqual(unknown, [], '存在未声明为能力的固定分发：' + unknown.join(', '))
})

test('v27 渲染统计扩展在取不到时显式标记', async () => {
  const source = readProbeTemplateText()
  assert.match(source, /GraphicsTryRenderStat\("batches"/)
  assert.match(source, /statsUnavailable/)
})
