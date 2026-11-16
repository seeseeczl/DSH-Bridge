// 适配器契约：内核只依赖这些形状，不依赖任何具体软件。
export const ADAPTER_REQUIRED = Object.freeze([
  'id',
  'displayName',
  'detect',
  'install',
  'handshake',
  'invoke',
  'uninstall',
])

export class AdapterError extends Error {
  constructor(code, message, detail) {
    super(message)
    this.name = 'AdapterError'
    this.code = code
    this.detail = detail
  }
}

/**
 * 校验适配器形状与能力命名空间。
 * 能力名必须以 `<adapterId>.` 开头，否则跨适配器会重名。
 */
export function validateAdapter(adapter) {
  if (!adapter || typeof adapter !== 'object') {
    throw new AdapterError('adapter_invalid', '适配器必须是对象')
  }
  for (const key of ADAPTER_REQUIRED) {
    const value = adapter[key]
    if (value === undefined || value === null) {
      throw new AdapterError('adapter_invalid', `适配器 ${adapter.id ?? '<unknown>'} 缺少成员 ${key}`)
    }
  }
  for (const key of ['detect', 'install', 'handshake', 'invoke', 'uninstall']) {
    if (typeof adapter[key] !== 'function') {
      throw new AdapterError('adapter_invalid', `适配器 ${adapter.id} 的 ${key} 必须是函数`)
    }
  }
  const capabilities = adapter.capabilities ?? []
  if (!Array.isArray(capabilities)) {
    throw new AdapterError('adapter_invalid', `适配器 ${adapter.id} 的 capabilities 必须是数组`)
  }
  for (const cap of capabilities) {
    if (typeof cap !== 'string' || !cap.startsWith(`${adapter.id}.`)) {
      throw new AdapterError(
        'capability_namespace_invalid',
        `能力名 ${String(cap)} 未使用 ${adapter.id}. 前缀`,
      )
    }
  }
  return adapter
}

/** 全局能力唯一性：不同适配器不得声明同名能力。 */
export function assertUniqueCapabilities(adapters) {
  const seen = new Map()
  for (const adapter of adapters) {
    for (const cap of adapter.capabilities ?? []) {
      const owner = seen.get(cap)
      if (owner && owner !== adapter.id) {
        throw new AdapterError('capability_conflict', `能力 ${cap} 同时被 ${owner} 与 ${adapter.id} 声明`)
      }
      seen.set(cap, adapter.id)
    }
  }
  return seen
}

/** 从能力名解析归属适配器。 */
export function adapterIdOfCapability(capability) {
  const index = capability.indexOf('.')
  return index > 0 ? capability.slice(0, index) : null
}
