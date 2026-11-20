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

// 可选成员（P3-59）：适配器按需实现，内核据此决定是否提供唤醒 / 扫描 / 事件 / 收敛等能力。
// 此前 bridge.mjs、preinstall.mjs、discovery.mjs 各写一遍 typeof 探测，缺失时静默降级且无处可查；
// 现在集中在此定义，注册期一次性算出能力表（adapterFeatureTable），缺失项显式记录而不是靠读代码发现。
export const ADAPTER_OPTIONAL = Object.freeze([
  'wake',
  'scan',
  'events',
  'settle',
  'backlog',
  'installStandalone',
  'isInstalled',
  'probePresence',
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
  // 可选成员一旦提供就必须可调用：否则 typeof 探测会把「实现错了」当成「没实现」，
  // 静默降级，正是 P3-59 要消除的问题。
  for (const key of ADAPTER_OPTIONAL) {
    const value = adapter[key]
    if (value !== undefined && value !== null && typeof value !== 'function') {
      throw new AdapterError(
        'adapter_invalid',
        `适配器 ${adapter.id} 的 ${key} 是可选成员，一旦提供必须是函数`,
      )
    }
  }
  return adapter
}

/**
 * 注册期一次性算出适配器对可选成员的实际支持情况，供内核取代散落的 typeof 探测。
 * 返回冻结对象；`missing` 用于诊断（bridge_targets / doctor），把「未实现」显式暴露出来。
 * `has(key)` 是给调用点读起来更直白的便捷判断。
 */
export function adapterFeatureTable(adapter) {
  const implemented = []
  const missing = []
  for (const key of ADAPTER_OPTIONAL) {
    if (typeof adapter?.[key] === 'function') implemented.push(key)
    else missing.push(key)
  }
  const implementedSet = new Set(implemented)
  return Object.freeze({
    implemented: Object.freeze(implemented),
    missing: Object.freeze(missing),
    has: (key) => implementedSet.has(key),
  })
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
