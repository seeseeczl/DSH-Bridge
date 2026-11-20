// 工具参数辅助：把模型传入的 JSON 字符串安全地转成对象，并校验 instance_id 形状。
//
// 参数来自模型输出，必须当作不可信输入：解析前先限大小，避免一个超大字符串
// 把进程内存打满（探针侧 MiniJson 已有 1 MiB 上限，两侧口径保持一致）。
//
// 本文件同时也是工具层的「通用前置辅助」集散地：各工具在真正调用 Bridge 之前的
// 参数校验与拒绝留痕都在这里，避免 4 个工具文件各写一份（P3-89/W2-D 的同源重复）。

const MAX_ARGS_BYTES = 1024 * 1024
/** instance_id 的字符上限：真实 ID 只有 20 来个字符，超过即视为伪造/污染输入。 */
const MAX_INSTANCE_ID_CHARS = 200

export function parseArgsJson(argsJson) {
  if (argsJson === undefined || argsJson === null || argsJson === '') return {}
  if (typeof argsJson === 'object') return argsJson
  const text = String(argsJson)
  if (Buffer.byteLength(text, 'utf8') > MAX_ARGS_BYTES) {
    throw Object.assign(
      new Error(`args_json 过大（${Buffer.byteLength(text, 'utf8')} 字节，上限 ${MAX_ARGS_BYTES}）；请拆分调用`),
      { code: 'args_too_large' },
    )
  }
  try {
    const value = JSON.parse(text)
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('args_json 必须是 JSON 对象')
    }
    return value
  } catch (error) {
    throw Object.assign(new Error(`args_json 解析失败：${error.message}`), { code: 'invalid_args' })
  }
}

function invalidInstanceId(received, reason) {
  return Object.assign(
    new Error(`instance_id 不合法（${reason}）：${JSON.stringify(String(received).slice(0, 80))}；`
      + '请使用 bridge_targets 返回的实例 ID（形如 unity:1a2b3c4d5e6f）'),
    { code: 'invalid_args', field: 'instance_id' },
  )
}

/** 参数非法：统一成带 code/field 的错误，便于调用方与 doctor 统计（P3-77）。 */
export function invalidArg(message, field) {
  return Object.assign(new Error(message), { code: 'invalid_args', field })
}

/**
 * instance_id 形状校验（P3-88 / P3-109）。
 *
 * 知识库工具会把 instance_id 直接拼进本地路径（目录名），一个 `..` 或 `a/b`
 * 就能把数据写到预期位置之外——形状必须在**任何落盘动作之前**拒绝。
 * 真实存在性由 bridge.requireInstance 负责；形状 + 存在性两种校验一起用才算「实例校验」。
 *
 * 注意：DSH 的 schema DSL 不支持 `pattern`（见 schema.mjs 的说明），所以只能在此执行期校验。
 * @returns {string} 去空白后的 instance_id
 */
export function assertInstanceId(value) {
  if (typeof value !== 'string') throw invalidInstanceId(value, '必须是字符串')
  const id = value.trim()
  if (!id) throw invalidInstanceId(value, '不能为空')
  if (id.length > MAX_INSTANCE_ID_CHARS) throw invalidInstanceId(value, `长度超过 ${MAX_INSTANCE_ID_CHARS}`)
  // C0/C1 控制字符：会把审计行/路径变成不可读或多行内容。
  if (/[\u0000-\u001f\u007f]/.test(id)) throw invalidInstanceId(value, '含控制字符')
  // 斜杠与反斜杠：路径分隔符，绝不能参与路径拼接。
  if (id.includes('/') || id.includes('\\')) throw invalidInstanceId(value, '不能包含路径分隔符')
  // 点段：'.' / '..' / 任何含 '..' 的写法都能让 join() 上溯。
  if (id === '.' || id === '..' || id.includes('..')) throw invalidInstanceId(value, '不能包含点段')
  return id
}

/**
 * 会话标识归一（P2-47）：只用于审计归因，不能成为新的注入面。
 * @returns {string|undefined} 合法则返回原值，未提供则 undefined
 */
export function normalizeSessionId(value) {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') {
    throw Object.assign(new Error('session_id 必须是字符串'), { code: 'invalid_args', field: 'session_id' })
  }
  const id = value.trim()
  if (!id) return undefined
  if (id.length > 128) {
    throw Object.assign(new Error('session_id 过长（上限 128 字符）'), { code: 'invalid_args', field: 'session_id' })
  }
  if (/[\u0000-\u001f\u007f]/.test(id)) {
    throw Object.assign(new Error('session_id 不能包含控制字符'), { code: 'invalid_args', field: 'session_id' })
  }
  return id
}

/**
 * 外部来源文本净化（P3-87）：事件 kind/at、工程路径、引擎版本都可能含 ESC 等控制字符，
 * 原样拼进工具文本会被终端解释成清屏/改色，伪造出「ERROR」行。
 * 保留 \n（\u000a）与 \t（\u0009），其余 C0/C1 控制字符与 U+2028/2029 一律替换。
 *
 * 放在这里而不是 tools/index.mjs：各工具文件都要用，而从 index.mjs 反向 import
 * 会形成循环依赖。tools/index.mjs 仍然 re-export，对外契约不变。
 */
export function textSafe(value) {
  return String(value ?? '').replace(/[\u0000-\u0008\u000b-\u001f\u007f\u2028\u2029]/g, '?')
}

/**
 * 前置拒绝留痕（P3-117）。
 *
 * 参数校验失败发生在任何 Bridge 调用之前，`call` 事件里不会出现这次尝试；
 * 没有这条记录，doctor 的成功率统计、以及「模型是不是在乱传参数」都无从判断。
 * 拒绝已经生效，因此审计写不进去不改变调用结果——这里吞掉审计异常。
 */
export async function recordRejection(bridge, event, payload) {
  if (typeof bridge?.observe !== 'function') return
  try {
    await bridge.observe(event, payload)
  } catch {
    // 留痕失败不影响「已经拒绝」这一事实。
  }
}

/**
 * 高权/不可逆操作执行前的审计闸门（P3-104）。
 *
 * 与 core 对 unity.code.execute 的口径一致（AA-SEC-004）：审计不可用时 fail-closed，
 * 而不是「先删掉、再补记一条可能写不进去的日志」。
 * 没有 audit 对象时（单元测试的桩 bridge）跳过闸门，但 observe 仍会被调用。
 * @throws {Error & {code: 'audit_unavailable'}} 审计被禁用或最近写入失败
 */
export async function auditBeforeMutation(bridge, event, payload) {
  const audit = bridge?.audit
  if (audit && typeof audit.status === 'function') {
    const status = audit.status()
    if (!status.available) {
      throw Object.assign(
        new Error(`审计不可用（${status.enabled
          ? `最近写入失败 ${status.failures} 次：${status.lastError ?? '未知原因'}`
          : '审计被禁用（auditPath 为空）'}）：该操作不可逆，为避免零留痕执行已拒绝。`),
        { code: 'audit_unavailable', audit: status, event },
      )
    }
  }
  if (typeof bridge?.observe === 'function') await bridge.observe(event, payload)
}
