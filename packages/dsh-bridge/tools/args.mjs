// 工具参数辅助：把模型传入的 JSON 字符串安全地转成对象。
export function parseArgsJson(argsJson) {
  if (argsJson === undefined || argsJson === null || argsJson === '') return {}
  if (typeof argsJson === 'object') return argsJson
  try {
    const value = JSON.parse(String(argsJson))
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('args_json 必须是 JSON 对象')
    }
    return value
  } catch (error) {
    throw Object.assign(new Error(`args_json 解析失败：${error.message}`), { code: 'invalid_args' })
  }
}
