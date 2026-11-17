#!/usr/bin/env node
// 能力验收脚本（V1/V3/V4/V5）：直连探针，不依赖 DSH 运行时。
//
// 用法：node scripts/verify-bridge-capabilities.mjs <projectPath>
// 每个用例打印 PASS/FAIL 与实测值，退出码非 0 表示存在失败。
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { unityAdapter } from '../packages/dsh-bridge/adapters/unity/index.mjs'
import { readInstance } from '../packages/dsh-bridge/transport/mailbox.mjs'
import { discover, inspectProject } from './bridge-cli.mjs'

const PROJECT = process.argv[2] ?? '/Users/long/Tuanjie3D/P376'
const ALLOW = ['unity.reflect.invoke', 'unity.api.invoke', 'unity.api.members', 'unity.api.batch']

const rows = []
function record(id, title, pass, actual) {
  rows.push({ id, title, pass, actual })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${title}`)
  console.log(`      ${typeof actual === 'string' ? actual : JSON.stringify(actual)}`)
}

async function connect() {
  const raw = await readInstance(PROJECT)
  if (!raw) throw new Error(`工程未安装探针：${PROJECT}`)
  return { instanceId: raw.instanceId, projectPath: PROJECT, bootId: raw.bootId, nonce: raw.nonce, pid: raw.pid }
}

const instance = await connect()
const call = (capability, args = {}, timeoutMs = 120000) => unityAdapter.invoke(instance, capability, args, { timeoutMs })

// ===== V1：读私有实例字段 + 多候选命中回传 =====
try {
  const found = await call('unity.object.find', { limit: 1 })
  const handle = found.objects?.[0]?.handle
  if (!handle) throw new Error('场景内没有可用对象')
  const single = await call('unity.reflect.invoke', { target: { handle }, member: 'm_CachedPtr' })
  const multi = await call('unity.reflect.invoke', {
    target: { handle }, member: 'm_NoSuchField', candidates: ['m_CachedPtr', 'm_InstanceID'],
  })
  const pass = single.resolvedMember === 'm_CachedPtr'
    && single.kind === 'field'
    && single.declaringType === 'UnityEngine.Object'
    && typeof single.result === 'string'
    && multi.resolvedMember === 'm_CachedPtr'
  record('V1', '读私有基类字段并回传 resolvedMember/kind/declaringType', pass, {
    single: { resolvedMember: single.resolvedMember, kind: single.kind, declaringType: single.declaringType, result: single.result },
    multiCandidate: { resolvedMember: multi.resolvedMember, kind: multi.kind },
  })
} catch (error) {
  record('V1', '读私有基类字段', false, `${error.message} ${error.detail ?? ''}`)
}

// ===== V2：取 ASE 窗口实例并对它调用实例方法 =====
// 复用 ASECLI 打开图的方式（CreateInstance + m_delayedLoadObject + Show + 布局事件），
// 但**不关闭**窗口，好让反射层用句柄访问它；结束时再关。
const ASE_SHADER = 'Assets/ArtResources/ArtModule_LiveDesktop/Art_Shaders/Ase_DT_CarModel_v0.3.shader'
try {
  const opened = await call('unity.code.execute', {
    code: `
var assetPath = ${JSON.stringify(ASE_SHADER)};
var shader = UnityEditor.AssetDatabase.LoadAssetAtPath<UnityEngine.Shader>(assetPath);
if (shader == null) throw new System.Exception("shader not found");
var flags = System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.NonPublic;
var textInfo = typeof(AmplifyShaderEditor.UIUtils).GetField("m_textInfo", System.Reflection.BindingFlags.Static | System.Reflection.BindingFlags.NonPublic);
if (textInfo != null && textInfo.GetValue(null) == null)
    textInfo.SetValue(null, new System.Globalization.CultureInfo("en-US", false).TextInfo);
var win = UnityEditor.EditorWindow.CreateInstance<AmplifyShaderEditor.AmplifyShaderEditorWindow>();
AmplifyShaderEditor.UIUtils.CurrentWindow = win;
typeof(AmplifyShaderEditor.AmplifyShaderEditorWindow).GetField("m_delayedLoadObject", flags).SetValue(win, shader);
win.Show();
var layoutEvent = new UnityEngine.Event(); layoutEvent.type = UnityEngine.EventType.Layout; win.SendEvent(layoutEvent);
var repaintEvent = new UnityEngine.Event(); repaintEvent.type = UnityEngine.EventType.Repaint; win.SendEvent(repaintEvent);
if (win.CurrentGraph == null) throw new System.Exception("graph did not load");
return win.CurrentGraph.AllNodes.Count;
`,
  })
  const windows = await call('unity.reflect.invoke', {
    target: { type: 'UnityEngine.Resources' }, member: 'FindObjectsOfTypeAll',
    argTypes: ['System.Type'], args: ['AmplifyShaderEditor.AmplifyShaderEditorWindow'],
  })
  const windowHandle = windows.result?.[0]?.handle
  const graph = await call('unity.reflect.invoke', {
    target: { handle: windowHandle }, member: 'CurrentGraph', candidates: ['OutsideGraph', 'm_mainGraphInstance'],
  })
  const master = await call('unity.reflect.invoke', {
    target: { handle: graph.result.$handle ?? graph.result.handle }, member: 'CurrentMasterNode',
  })
  const uniqueId = await call('unity.reflect.invoke', {
    target: { handle: master.result.handle ?? master.result.$handle }, member: 'UniqueId',
  })
  const invoked = await call('unity.reflect.invoke', {
    target: { handle: windowHandle },
    member: 'ConnectInputToOutput',
    argTypes: ['System.Int32', 'System.Int32', 'System.Int32', 'System.Int32', 'System.Boolean'],
    args: [uniqueId.result, 0, uniqueId.result, 0, false],
  })
  const pass = typeof opened.result === 'number'
    && windowHandle != null
    && graph.resolvedMember === 'CurrentGraph'
    && master.result?.fullType === 'AmplifyShaderEditor.TemplateMultiPassMasterNode'
    && invoked.kind === 'method'
    && invoked.declaringType === 'AmplifyShaderEditor.AmplifyShaderEditorWindow'
  record('V2', '取 ASE 窗口实例并调用实例方法 ConnectInputToOutput', pass, {
    window: windowHandle, nodes: opened.result, graph: graph.resolvedMember,
    master: master.result?.fullType, uniqueId: uniqueId.result,
    invoked: { resolvedMember: invoked.resolvedMember, kind: invoked.kind, declaringType: invoked.declaringType },
  })
} catch (error) {
  record('V2', '取 ASE 窗口实例并调用实例方法', false, `${error.message} ${String(error.detail ?? '').slice(0, 300)}`)
} finally {
  // 关闭临时窗口并清空 CurrentWindow，避免把编辑器留在半开状态。
  await call('unity.code.execute', {
    code: `
var win = AmplifyShaderEditor.UIUtils.CurrentWindow;
if (win != null) { win.Close(); UnityEngine.Object.DestroyImmediate(win); AmplifyShaderEditor.UIUtils.CurrentWindow = null; }
return 0;`,
  }).catch(() => null)
}

// ===== V3：三层嵌套（dict → dict → array）且不截断 =====
try {
  const code = [
    'var level3 = new System.Collections.Generic.List<object>();',
    'level3.Add(1); level3.Add(2); level3.Add(3);',
    'var level2 = new System.Collections.Generic.Dictionary<string, object>();',
    'level2["items"] = level3; level2["label"] = "l2";',
    'var level1 = new System.Collections.Generic.Dictionary<string, object>();',
    'level1["child"] = level2; level1["name"] = "l1";',
    'return level1;',
  ].join('\n')
  const data = await call('unity.code.execute', { code })
  const value = data.result
  const pass = data.resultTruncated === false
    && value?.name === 'l1'
    && value?.child?.label === 'l2'
    && Array.isArray(value?.child?.items)
    && value.child.items.length === 3
  record('V3', '一次调用返回三层嵌套 dict→dict→array 且 resultTruncated=false', pass, {
    resultTruncated: data.resultTruncated, result: value, backend: data.backend,
  })
} catch (error) {
  record('V3', '三层嵌套返回', false, `${error.message} ${String(error.detail ?? '').slice(0, 400)}`)
}

// ===== V4：batch 第 3 个失败 → failedAt=2 / rolledBack=true / 无 staging 残留 =====
// 放在 Library/ 而不是 Assets/：不触发资产导入，也不会污染工程可见资产。
const staging = 'Library/__dsh_v4_staging.txt'
try {
  await rm(join(PROJECT, staging), { force: true })
  const data = await call('unity.api.batch', {
    calls: [
      { code: `System.IO.File.WriteAllText("${staging}", "staged"); return "written";` },
      { code: `return System.IO.File.Exists("${staging}");` },
      { code: 'throw new System.Exception("intentional failure for V4");' },
    ],
    stopOnError: true,
    rollbackOnError: true,
    onError: [{ code: `System.IO.File.Delete("${staging}"); return "deleted";` }],
  })
  const residue = await readFile(join(PROJECT, staging), 'utf8').catch(() => null)
  const pass = data.failedAt === 2
    && data.rolledBack === true
    && data.undoGroupOpened === true
    && data.compensations?.[0]?.ok === true
    && residue === null
  record('V4', 'batch 失败定位 + Undo 回滚 + 补偿清理，工程内无 staging 残留', pass, {
    failedAt: data.failedAt,
    rolledBack: data.rolledBack,
    undoGroupOpened: data.undoGroupOpened,
    compensations: data.compensations,
    residueExists: residue !== null,
  })
} catch (error) {
  record('V4', 'batch 事务回滚', false, `${error.message} ${String(error.detail ?? '').slice(0, 400)}`)
} finally {
  // 无论 batch 成功、失败还是编译不可用，都不允许把 staging 留在用户工程里。
  await rm(join(PROJECT, staging), { force: true }).catch(() => null)
}

// ===== V5：CLI 发现协议 + stale 排除 =====
try {
  const live = await inspectProject(PROJECT)
  const fake = join(PROJECT, 'Library', 'DSHBridgeStaleProbe')
  const staleInstance = {
    v: 1, discoveryVersion: 1, instanceId: 'unity:deadbeefcafe', bootId: 'ffffffffffffffff',
    nonce: 'n', pid: 999999, projectPath: fake, engine: 'unity', probeVersion: '8',
    lastSeenAt: new Date(Date.now() - 3600_000).toISOString(), staleAfterMs: 6000,
    capabilities: ['unity.editor.status'], grantedCapabilities: [],
  }
  await mkdir(join(fake, 'Library', 'DSHBridge'), { recursive: true })
  await writeFile(join(fake, 'Library', 'DSHBridge', 'instance.json'), JSON.stringify(staleInstance), 'utf8')
  const staleView = await inspectProject(fake)
  const discovered = await discover({ roots: [PROJECT, fake], maxDepth: 2 })
  const ids = discovered.instances.map((item) => item.instanceId)
  const conditions = {
    liveReady: live.status === 'ready',
    discoveryVersion: live.discoveryVersion === 1,
    staleDetected: staleView.status === 'stale',
    staleExcluded: !ids.includes('unity:deadbeefcafe'),
    liveFound: ids.includes(live.instanceId),
  }
  const pass = Object.values(conditions).every(Boolean)
  record('V5', '纯文件读取可唯一定位可用实例，stale 被排除', pass, {
    live: { instanceId: live.instanceId, status: live.status, discoveryVersion: live.discoveryVersion, sourceHash: live.sourceHash },
    stale: { instanceId: staleView.instanceId, status: staleView.status },
    discovered: ids,
    conditions,
    liveStatusRaw: live.status,
    staleStatusRaw: staleView.status,
  })
  await rm(fake, { recursive: true, force: true })
} catch (error) {
  record('V5', 'CLI 发现协议', false, `${error.message}`)
}

const failed = rows.filter((row) => !row.pass)
console.log(`\n结果：${rows.length - failed.length}/${rows.length} 通过`)
process.exit(failed.length === 0 ? 0 : 1)
