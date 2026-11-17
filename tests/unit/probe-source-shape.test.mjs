import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { renderProbe, PROBE_TEMPLATE_PATH } from '../../packages/dsh-bridge/adapters/unity/probe.template.mjs'

// 探针源码形态检查（AA-OPT-013）。
//
// 这里只回答「探针源码里有没有这个机制」，**不证明行为正确**——行为由
// tests/unity-probe/capability-semantics.test.mjs 真实驱动验证。两者分工明确，
// 避免"源码包含某个字符串 = 功能正确"的假覆盖。
test('探针源码包含过期校验、编译状态与路径边界机制', async () => {
  const source = await readFile(PROBE_TEMPLATE_PATH, 'utf8')
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
  const source = renderProbe({ probeVersion: '9' })
  assert.match(source, /ProbeVersion = "9"/)
  assert.match(source, /class DSHBridgeProbe/)
  assert.match(source, /pairing_mismatch/)
  assert.match(source, /capability_unsupported/)
  assert.equal(source.includes('__PROBE_VERSION__'), false)
})

test('探针不引入监听端口或外部进程', () => {
  const source = renderProbe({ probeVersion: '1' })
  assert.equal(/new TcpListener|HttpListener|Socket\(/.test(source), false, '探针不得监听端口')
  assert.equal(/Process\.Start\(/.test(source), false, '探针不得启动外部进程')
  assert.equal(/WebClient|HttpClient/.test(source), false, '探针不得访问网络')
})
