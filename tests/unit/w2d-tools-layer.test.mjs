// W2-D 工具层回归：生命周期工具契约（restartRequired / keep_diagnostics / 引擎闸门）、
// bridge_call 的 session_id 与 configDrift 提示、知识库实例校验与「先记后删」、
// bridge_docs 的 limit 校验，以及工具运行时缺失时的降级行为。
// 对应红队发现：P2-15 / P2-31 / P2-39 / P2-45 / P2-47 / P3-61 / P3-72 / P3-77 / P3-88 / P3-103 / P3-104 / P3-109 / P3-117。
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createKnowledgeTools } from '../../packages/dsh-bridge/tools/bridge-knowledge.mjs'
import { createLifecycleTools } from '../../packages/dsh-bridge/tools/bridge-lifecycle.mjs'
import { createDocsTool } from '../../packages/dsh-bridge/tools/bridge-docs.mjs'
import { createBridgeTools } from '../../packages/dsh-bridge/tools/index.mjs'

const defineTool = (definition) => definition
const TOOLS_INDEX = fileURLToPath(new URL('../../packages/dsh-bridge/tools/index.mjs', import.meta.url))

/** 递归确认无损 JSON，并核对没有 schema 未声明的顶层字段（DSH 真的会这样校验）。 */
function assertOutputContract(tool, value) {
  const walk = (node, path) => {
    assert.notEqual(node, undefined, `${path} 是 undefined，DSH 会判定为 not lossless JSON`)
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${path}[${index}]`))
      return
    }
    if (node && typeof node === 'object') {
      for (const [key, item] of Object.entries(node)) walk(item, `${path}.${key}`)
    }
  }
  walk(value, '$')
  const declared = new Set(Object.keys(tool.output.schema.properties ?? {}))
  for (const key of Object.keys(value)) {
    assert.ok(declared.has(key), `${tool.name} 返回了 schema 未声明的字段：${key}`)
  }
}

function lifecycleTool(tools, name) {
  const found = tools.find((item) => item.name === name)
  assert.ok(found, `未找到工具 ${name}`)
  return found
}

// ---------- P2-15 / P2-45 / P3-103：restartRequired 必须出现在 schema 与载荷里 ----------

test('P2-15/P3-103 bridge_install 输出 restartRequired，且 schema 已声明', async () => {
  const bridge = {
    install: async () => ({
      dryRun: false,
      changed: true,
      reloadExpected: true,
      restartRequired: true,
      probeVersion: '13',
      files: [{ path: '/p/x.cs', relativePath: 'Packages/com.dsh.bridge/Editor/x.cs' }],
      ready: { ready: true },
    }),
  }
  const install = lifecycleTool(createLifecycleTools(defineTool, bridge), 'bridge_install')
  const value = await install.execute({ instance_id: 'unity:test' })
  assertOutputContract(install, value)
  assert.equal(value.restartRequired, true, 'restartRequired 必须透传给调用方')
  const text = install.output.render({}, value)[0].text
  assert.match(text, /需要重启目标编辑器才生效/)
  assert.doesNotMatch(text, /将编译一次并重载/, '重启要求成立时不能说「将自动重载」')
})

test('P2-45 dry-run 的 restartRequired 为 false，且不误报重启', async () => {
  const bridge = {
    install: async () => ({
      dryRun: true, changed: true, reloadExpected: true, restartRequired: false, probeVersion: '13', files: [],
    }),
  }
  const install = lifecycleTool(createLifecycleTools(defineTool, bridge), 'bridge_install')
  const value = await install.execute({ instance_id: 'unity:test', dry_run: true })
  assertOutputContract(install, value)
  assert.equal(value.restartRequired, false)
  const text = install.output.render({}, value)[0].text
  assert.match(text, /预览/)
  assert.doesNotMatch(text, /需要重启/)
})

test('P2-45 探针未就绪（ready.ready=false）时文案如实说明失败', async () => {
  const bridge = {
    install: async () => ({
      dryRun: false,
      changed: true,
      reloadExpected: true,
      restartRequired: true,
      probeVersion: '13',
      files: [],
      ready: { ready: false, reason: 'probe_timeout', hint: '检查编辑器编译错误' },
    }),
  }
  const install = lifecycleTool(createLifecycleTools(defineTool, bridge), 'bridge_install')
  const value = await install.execute({ instance_id: 'unity:test' })
  const text = install.output.render({}, value)[0].text
  assert.match(text, /仍未就绪/)
  assert.match(text, /probe_timeout/)
  assert.match(text, /检查编辑器编译错误/)
  assert.doesNotMatch(text, /^探针已写入[^\n]*将编译一次并重载/m, '失败不能被渲染成成功')
})

// ---------- P2-39：引擎版本闸门必须能从工具面显式放行 ----------

test('P2-39 allow_unsupported_engine 透传到 bridge.install', async () => {
  const seen = []
  const bridge = {
    install: async (instanceId, options) => {
      seen.push({ instanceId, options })
      return { dryRun: true, changed: false, reloadExpected: false, restartRequired: false, probeVersion: '13', files: [] }
    },
  }
  const install = lifecycleTool(createLifecycleTools(defineTool, bridge), 'bridge_install')
  await install.execute({ instance_id: 'unity:test', allow_unsupported_engine: true })
  await install.execute({ instance_id: 'unity:test' })
  assert.equal(seen[0].options.allowUnsupportedEngine, true, '显式放行必须传给 installer 的版本闸门')
  assert.equal(seen[1].options.allowUnsupportedEngine, false, '默认必须是拒绝（写盘前拦下低版本引擎）')
})

test('P2-39 installer 的 engine_too_old 原样抛给调用方', async () => {
  const bridge = {
    install: async () => {
      throw Object.assign(new Error('目标工程引擎 2021.3 低于探针要求 2022.3'), {
        code: 'engine_too_old', engineVersion: '2021.3', minimum: '2022.3',
      })
    },
  }
  const install = lifecycleTool(createLifecycleTools(defineTool, bridge), 'bridge_install')
  await assert.rejects(
    () => install.execute({ instance_id: 'unity:test' }),
    (error) => error.code === 'engine_too_old',
  )
})

// ---------- P2-31：channelPurged 透传 + keep_diagnostics 的 fail-closed ----------

test('P2-31 bridge_uninstall 回传 channelPurged（无残留即 null）', async () => {
  const bridge = {
    uninstall: async () => ({ removed: ['/p/Packages/com.dsh.bridge'], excludeRemoved: true, channelPurged: '/p/Library/DSHBridge', note: '已删除' }),
  }
  const uninstall = lifecycleTool(createLifecycleTools(defineTool, bridge), 'bridge_uninstall')
  const value = await uninstall.execute({ instance_id: 'unity:test' })
  assertOutputContract(uninstall, value)
  assert.equal(value.channelPurged, '/p/Library/DSHBridge')
  assert.match(uninstall.output.render({}, value)[0].text, /已清理探针通道数据/)
})

test('P2-31 channelPurged=null 时输出仍是合法（null 不是缺失）', async () => {
  const bridge = {
    uninstall: async () => ({ removed: [], channelPurged: null, note: '探针包不存在；无通道数据可清理' }),
  }
  const uninstall = lifecycleTool(createLifecycleTools(defineTool, bridge), 'bridge_uninstall')
  const value = await uninstall.execute({ instance_id: 'unity:test' })
  assertOutputContract(uninstall, value)
  assert.equal(value.channelPurged, null, 'null 是「没有可清理的数据」，必须原样回传')
})

test('P2-31 core 未透传选项时 keep_diagnostics 必须 fail-closed（不静默删证据）', async () => {
  let called = false
  const observed = []
  const bridge = {
    uninstall: async () => {
      called = true
      return { removed: [], channelPurged: null }
    },
    observe: async (event, payload) => { observed.push({ event, payload }) },
  }
  const uninstall = lifecycleTool(createLifecycleTools(defineTool, bridge), 'bridge_uninstall')
  await assert.rejects(
    () => uninstall.execute({ instance_id: 'unity:test', keep_diagnostics: true }),
    (error) => error.code === 'unsupported_option' && error.option === 'keep_diagnostics',
  )
  assert.equal(called, false, '拒绝必须发生在真正删除之前')
  assert.equal(observed.length, 1, 'P3-117：前置拒绝也要留痕')
  assert.equal(observed[0].payload.code, 'unsupported_option')
})

test('P2-31 core 声明支持时 keep_diagnostics 透传', async () => {
  const seen = []
  const bridge = {
    supportsUninstallOptions: true,
    uninstall: async (instanceId, options) => {
      seen.push({ instanceId, options })
      return { removed: [], channelPurged: null, note: '已按 keepDiagnostics 保留 Library/DSHBridge 通道数据' }
    },
  }
  const uninstall = lifecycleTool(createLifecycleTools(defineTool, bridge), 'bridge_uninstall')
  const value = await uninstall.execute({ instance_id: 'unity:test', keep_diagnostics: true })
  assert.deepEqual(seen[0].options, { keepDiagnostics: true })
  assert.match(uninstall.output.render({}, value)[0].text, /保留/)
})

// ---------- P3-93：安装描述必须说「多文件包」而不是「单个源文件」 ----------

test('P3-93 bridge_install 描述写明多文件 embedded package', async () => {
  const tools = createLifecycleTools(defineTool, { install: async () => ({}), uninstall: async () => ({ removed: [] }) })
  const install = lifecycleTool(tools, 'bridge_install')
  assert.doesNotMatch(install.description, /single source file/)
  assert.match(install.description, /embedded package/i)
  assert.match(install.description, /15 C# files/)
  assert.match(install.description, /restartRequired/)
})

// ---------- P2-47 / P3-72 / P3-117：bridge_call ----------

function fakeCallBridge({ callResult = { ok: true }, instance = null } = {}) {
  const calls = []
  const observed = []
  return {
    calls,
    observed,
    adapters: new Map([['unity', {}]]),
    capabilities: () => [],
    observe: async (event, payload) => { observed.push({ event, payload }) },
    async targets() { return [] },
    async requireInstance() {
      if (!instance) throw Object.assign(new Error('未知实例'), { code: 'instance_not_found' })
      return instance
    },
    async call(instanceId, capability, args, options) {
      calls.push({ instanceId, capability, args, options })
      return typeof callResult === 'function' ? callResult() : callResult
    },
  }
}

async function callToolOf(bridge) {
  const tools = await createBridgeTools({ bridge, defineTool })
  return tools.find((item) => item.name === 'bridge_call')
}

test('P2-47 session_id 透传给 Bridge（审计可归因）', async () => {
  const bridge = fakeCallBridge()
  const call = await callToolOf(bridge)
  await call.execute({ instance_id: 'unity:1a2b3c4d5e6f', capability: 'unity.editor.status', session_id: 'sess-42' }, {})
  assert.equal(bridge.calls[0].options.sessionId, 'sess-42')
})

test('P2-47 宿主在上下文里注入会话时也能取到', async () => {
  const bridge = fakeCallBridge()
  const call = await callToolOf(bridge)
  await call.execute({ instance_id: 'unity:1a2b3c4d5e6f', capability: 'unity.editor.status' }, { sessionId: 'ctx-7' })
  assert.equal(bridge.calls[0].options.sessionId, 'ctx-7')
})

test('P2-47 非法 session_id 报 invalid_args 且不留半截调用', async () => {
  const bridge = fakeCallBridge()
  const call = await callToolOf(bridge)
  await assert.rejects(
    () => call.execute({ instance_id: 'unity:1a2b3c4d5e6f', capability: 'unity.editor.status', session_id: 'a\nb' }, {}),
    (error) => error.code === 'invalid_args' && error.field === 'session_id',
  )
  assert.equal(bridge.calls.length, 0, '参数校验失败不得下发请求')
  assert.equal(bridge.observed.at(-1).event, 'call_rejected', 'P3-117：拒绝路径必须留痕')
})

test('P3-72 实例带 configDrift 时 bridge_call 显式提示', async () => {
  const bridge = fakeCallBridge({ instance: { instanceId: 'unity:1a2b3c4d5e6f', configDrift: { deniedAdded: ['unity.menu.execute'] } } })
  const call = await callToolOf(bridge)
  const value = await call.execute({ instance_id: 'unity:1a2b3c4d5e6f', capability: 'unity.editor.status' }, {})
  assertOutputContract(call, value)
  assert.deepEqual(value.configDrift, { deniedAdded: ['unity.menu.execute'] })
  const text = call.output.render({}, value)[0].text
  assert.match(text, /授权快照/)
  assert.match(text, /bridge_install/)
})

test('P3-72 无漂移时不出现 configDrift 字段（不制造噪声）', async () => {
  const bridge = fakeCallBridge({ instance: { instanceId: 'unity:1a2b3c4d5e6f' } })
  const call = await callToolOf(bridge)
  const value = await call.execute({ instance_id: 'unity:1a2b3c4d5e6f', capability: 'unity.editor.status' }, {})
  assert.equal('configDrift' in value, false)
})

test('P3-72 bridge_targets 汇总需要重装探针的实例', async () => {
  const observed = []
  const bridge = {
    adapters: new Map([['unity', {}]]),
    capabilities: () => [],
    observe: async (event, payload) => { observed.push({ event, payload }) },
    targets: async () => [
      { instanceId: 'unity:aaaaaaaaaaaa', status: 'ready', nonce: 'SECRET', configDrift: { grantedChanged: true } },
      { instanceId: 'unity:bbbbbbbbbbbb', status: 'ready', nonce: 'SECRET2' },
    ],
  }
  const tools = await createBridgeTools({ bridge, defineTool })
  const targets = tools.find((item) => item.name === 'bridge_targets')
  const value = await targets.execute({})
  assertOutputContract(targets, value)
  assert.deepEqual(value.configDrift, ['unity:aaaaaaaaaaaa'])
  assert.equal(JSON.stringify(value).includes('SECRET'), false, 'nonce 仍然不得外发')
  assert.match(targets.output.render({}, value)[0].text, /授权快照/)
  assert.deepEqual(observed[0].payload.configDrift, ['unity:aaaaaaaaaaaa'])
})

// ---------- P3-88 / P3-109 / P3-104：知识库实例校验与先记后删 ----------

async function withTempHome(fn) {
  const home = await mkdtemp(join(tmpdir(), 'dsh-bridge-w2d-'))
  const previous = process.env.HOME
  process.env.HOME = home
  try {
    return await fn(home)
  } finally {
    if (previous === undefined) delete process.env.HOME
    else process.env.HOME = previous
    await rm(home, { recursive: true, force: true })
  }
}

test('P3-109 instance_id 含点段/路径分隔符时在落盘前被拒绝', async () => {
  await withTempHome(async () => {
    const bridge = { observe: async () => {} }
    const tools = createKnowledgeTools(defineTool, bridge)
    const save = lifecycleTool(tools, 'bridge_knowledge_save')
    for (const bad of ['..', '.', 'a/b', 'a\\b', '', 'a\u0000b']) {
      await assert.rejects(
        () => save.execute({ instance_id: bad, topic: 't', content: 'x' }),
        (error) => error.code === 'invalid_args' && error.field === 'instance_id',
        `instance_id=${JSON.stringify(bad)} 必须被拒绝`,
      )
    }
    // 关键断言：拒绝发生在写盘之前——知识库根目录连一级都不该被创建。
    const bridgeRoot = join(homedir(), '.dsh', 'bridge')
    const leftovers = await readdir(bridgeRoot).catch(() => [])
    assert.deepEqual(leftovers, [], `不得创建任何知识库目录，实际：${leftovers.join(',')}`)
  })
})

test('P3-88 未知实例在读写之前被 requireInstance 拦下', async () => {
  await withTempHome(async () => {
    const bridge = {
      observe: async () => {},
      requireInstance: async (instanceId) => {
        throw Object.assign(new Error(`未知实例 ${instanceId}`), { code: 'instance_not_found' })
      },
    }
    const tools = createKnowledgeTools(defineTool, bridge)
    for (const name of ['bridge_knowledge_save', 'bridge_knowledge_list', 'bridge_knowledge_read', 'bridge_knowledge_delete']) {
      const tool = lifecycleTool(tools, name)
      const args = name === 'bridge_knowledge_list' ? { instance_id: 'unity:000000000000' } : { instance_id: 'unity:000000000000', topic: 't', content: 'x' }
      await assert.rejects(() => tool.execute(args), (error) => error.code === 'instance_not_found', `${name} 必须校验实例`)
    }
    assert.deepEqual(await readdir(join(homedir(), '.dsh', 'bridge')).catch(() => []), [])
  })
})

test('P3-104 bridge_knowledge_delete 先记审计再删除', async () => {
  await withTempHome(async () => {
    const order = []
    const bridge = {
      audit: { status: () => ({ available: true, enabled: true, failures: 0, lastError: null }) },
      observe: async (event, payload) => { order.push({ event, payload }) },
    }
    const tools = createKnowledgeTools(defineTool, bridge)
    const save = lifecycleTool(tools, 'bridge_knowledge_save')
    const remove = lifecycleTool(tools, 'bridge_knowledge_delete')
    await save.execute({ instance_id: 'unity:test', topic: '待删主题', content: '正文' })
    order.length = 0
    const value = await remove.execute({ instance_id: 'unity:test', topic: '待删主题' })
    assert.equal(value.removed, true)
    assert.equal(order[0].event, 'knowledge_delete')
    assert.equal(order[0].payload.phase, 'before', '删除前必须先落下审计意图')
    assert.equal(order.at(-1).payload.phase, 'after', '删除后补记结果')
  })
})

test('P3-104 审计不可用时删除被 fail-closed 拒绝，文档仍存在', async () => {
  await withTempHome(async () => {
    let available = true
    const bridge = {
      audit: { status: () => ({ available, enabled: true, failures: available ? 0 : 3, lastError: available ? null : 'EIO' }) },
      observe: async () => {},
    }
    const tools = createKnowledgeTools(defineTool, bridge)
    const save = lifecycleTool(tools, 'bridge_knowledge_save')
    const remove = lifecycleTool(tools, 'bridge_knowledge_delete')
    const saved = await save.execute({ instance_id: 'unity:test', topic: '保命主题', content: '正文' })
    assert.ok(saved.bytes > 0)

    available = false
    await assert.rejects(
      () => remove.execute({ instance_id: 'unity:test', topic: '保命主题' }),
      (error) => error.code === 'audit_unavailable',
    )
    const read = lifecycleTool(tools, 'bridge_knowledge_read')
    const found = await read.execute({ instance_id: 'unity:test', topic: '保命主题' })
    // readTopic 返回带 front matter 的整篇正文，只要正文还在就说明删除没有发生。
    assert.match(found.content, /正文/, '审计不可用时不能真的删掉文档')
  })
})

// ---------- P3-77：bridge_docs 的 limit ----------

test('P3-77 bridge_docs 非法 limit 返回 invalid_args 而不是静默回退', async () => {
  const docs = createDocsTool(defineTool)
  for (const limit of ['abc', -1, 0, 2.5, 999]) {
    const value = await docs.execute({ symbol: 'Rigidbody', limit })
    assert.equal(value.mode, 'error', `limit=${limit} 必须报错`)
    assert.equal(value.error.code, 'invalid_args')
  }
  const ok = await docs.execute({ symbol: 'Rigidbody', limit: 1 })
  assert.notEqual(ok.mode, 'error')
})

// ---------- P3-61：工具运行时缺失时降级为「不注册 + warning」 ----------

test('P3-61 解析不到宿主 tools 包时返回空工具集并打出结构化 warning', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-bridge-nowhere-'))
  const script = `
    import { createBridgeTools } from ${JSON.stringify(pathToFileURL(TOOLS_INDEX).href)}
    const tools = await createBridgeTools({ bridge: {} })
    process.stdout.write('LEN=' + tools.length + '\\n')
  `
  const env = { PATH: process.env.PATH, HOME: home, DSH_BRIDGE_LOG_LEVEL: 'warn' }
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], { env, cwd: home })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, stdout, stderr }))
  }).finally(() => rm(home, { recursive: true, force: true }))
  assert.equal(result.code, 0, `插件激活不得失败：${result.stderr.slice(0, 400)}`)
  assert.match(result.stdout, /LEN=0/, '解析失败时应注册 0 个 bridge_* 工具而不是抛错')
  assert.match(result.stderr, /bridge_tools_unavailable/, '必须留下结构化 warning')
  assert.match(result.stderr, /tools_runtime_missing/)
})

// ---------- 输出 schema 必须能被宿主真的编译并通过值校验（BUG-0002 的根因防线） ----------

/**
 * 解析宿主的 @deepseek-ai/dsh-tools。解析不到（干净 runner）时返回 null，
 * 由调用方跳过这组断言——不跳过就等于强迫单测依赖本机 DSH 安装。
 */
async function loadHostSchemaTools() {
  try {
    const { createRequire } = await import('node:module')
    const base = process.env.DSH_PROFILE_DIR
      ? join(process.env.DSH_PROFILE_DIR, 'package.json')
      : fileURLToPath(new URL('../../package.json', import.meta.url))
    const require = createRequire(base)
    return await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-tools')).href)
  } catch {
    return null
  }
}

test('P2-15/P2-31 改动过的工具：输出 schema 可被宿主编译，且样例值通过校验', async (t) => {
  const host = await loadHostSchemaTools()
  if (!host?.valueSchemaSpecToJsonSchema || !host?.validateJsonSchemaValue) {
    t.skip('本机解析不到宿主的 @deepseek-ai/dsh-tools，跳过 schema 编译校验')
    return
  }
  const installBridge = {
    install: async () => ({
      dryRun: false, changed: true, reloadExpected: true, restartRequired: true,
      probeVersion: '13', files: [], ready: { ready: false, reason: 'probe_timeout' }, exclude: {}, activation: {},
    }),
    uninstall: async () => ({ removed: ['/p/x'], channelPurged: null, note: 'ok', excludeRemoved: false }),
  }
  const lifecycle = createLifecycleTools(defineTool, installBridge)
  const samples = [
    [lifecycleTool(lifecycle, 'bridge_install'), await lifecycleTool(lifecycle, 'bridge_install').execute({ instance_id: 'unity:test' })],
    [lifecycleTool(lifecycle, 'bridge_uninstall'), await lifecycleTool(lifecycle, 'bridge_uninstall').execute({ instance_id: 'unity:test' })],
  ]
  const callBridge = fakeCallBridge({ instance: { instanceId: 'unity:1a2b3c4d5e6f', configDrift: { x: 1 } } })
  const bridgeTools = await createBridgeTools({ bridge: callBridge, defineTool })
  const call = bridgeTools.find((item) => item.name === 'bridge_call')
  samples.push([call, await call.execute({ instance_id: 'unity:1a2b3c4d5e6f', capability: 'unity.editor.status' }, {})])

  for (const [tool, value] of samples) {
    const json = host.valueSchemaSpecToJsonSchema(tool.output.schema)
    const violations = host.validateJsonSchemaValue(json, value)
    assert.deepEqual(violations, [], `${tool.name} 的返回值不符合自身 output schema：${violations.join('; ')}`)
  }
})
