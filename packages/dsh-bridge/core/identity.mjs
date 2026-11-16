// 实例身份：稳定段（工程哈希）+ 易变段（bootId/nonce），用于多实例隔离与请求配对。
import { createHash, randomBytes } from 'node:crypto'
import { resolve } from 'node:path'

const HEX = /^[0-9a-f]+$/

/** 工程路径哈希，作为 instanceId 的稳定段。 */
export function projectHash(projectPath) {
  return createHash('sha1').update(resolve(projectPath)).digest('hex').slice(0, 12)
}

/** adapter 前缀 + 工程哈希；同一工程重启不变，不同工程必不同。 */
export function instanceIdFor(adapterId, projectPath) {
  return `${adapterId}:${projectHash(projectPath)}`
}

/** 每次进程启动新的 bootId；旧通道目录不再被写入。 */
export function newBootId() {
  return randomBytes(8).toString('hex')
}

/** 防伪造：DSH 从 instance.json 读到后必须原样回传。 */
export function newNonce() {
  return randomBytes(16).toString('hex')
}

export function newRequestId() {
  return `req_${Date.now().toString(36)}_${randomBytes(6).toString('hex')}`
}

export function isHex(value, len) {
  return typeof value === 'string' && value.length === len && HEX.test(value)
}

/**
 * 校验请求/响应是否属于同一实例会话。
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
export function verifyPairing(envelope, identity) {
  if (!envelope || typeof envelope !== 'object') return { ok: false, reason: 'not_an_object' }
  if (envelope.v !== 1) return { ok: false, reason: 'unsupported_protocol_version' }
  if (envelope.instanceId !== identity.instanceId) return { ok: false, reason: 'instance_mismatch' }
  if (envelope.bootId !== identity.bootId) return { ok: false, reason: 'boot_mismatch' }
  if (envelope.nonce !== identity.nonce) return { ok: false, reason: 'nonce_mismatch' }
  return { ok: true }
}

/** 由探针写入的 instance.json 归一化，缺字段即视为不可用。 */
export function normalizeInstance(raw, { adapterId, projectPath } = {}) {
  if (!raw || typeof raw !== 'object') return null
  const required = ['bootId', 'nonce', 'pid', 'probeVersion']
  if (required.some((key) => raw[key] === undefined || raw[key] === null || raw[key] === '')) return null
  const resolvedProject = raw.projectPath ?? projectPath
  return {
    adapterId: adapterId ?? 'unknown',
    instanceId: raw.instanceId ?? (resolvedProject ? instanceIdFor(adapterId ?? 'unknown', resolvedProject) : undefined),
    bootId: String(raw.bootId),
    nonce: String(raw.nonce),
    pid: Number(raw.pid),
    projectPath: resolvedProject,
    unityVersion: raw.unityVersion ?? null,
    engine: raw.engine ?? null,
    probeVersion: String(raw.probeVersion),
    startedAt: raw.startedAt ?? null,
    lastSeenAt: raw.lastSeenAt ?? null,
    scene: raw.scene ?? null,
    isPlaying: raw.isPlaying ?? null,
    capabilities: Array.isArray(raw.capabilities) ? raw.capabilities.map(String) : [],
  }
}
