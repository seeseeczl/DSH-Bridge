// 工具间共享的参数 schema 片段。
export const INSTANCE_ID = {
  type: 'string',
  required: true,
  description: '实例 ID，来自 bridge_targets（形如 unity:1a2b3c4d5e6f）。',
}
