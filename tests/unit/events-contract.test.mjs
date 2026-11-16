import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { renderProbe, PROBE_TEMPLATE_PATH } from '../../packages/dsh-bridge/adapters/unity/probe.template.mjs'

// REG-EVENT-001：探针必须区分编译成功/失败，并对过期请求拒绝执行。
test('探针声明过期校验与真实编译状态', async () => {
  const source = await readFile(PROBE_TEMPLATE_PATH, 'utf8')
  assert.match(source, /deadlineMs/, '必须读取 deadlineMs')
  assert.match(source, /issuedAt/, '必须读取 issuedAt')
  assert.match(source, /"expired"/, '过期请求必须返回 expired 错误码')
  assert.match(source, /scriptCompilationFailed/, '编译完成事件必须查询真实失败状态')
  assert.match(source, /stateKnown/, '无法确认时必须显式标注')
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
