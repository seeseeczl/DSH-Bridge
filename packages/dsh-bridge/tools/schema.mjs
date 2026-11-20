// 工具间共享的参数 schema 片段。
//
// P3-88 / P3-109 要求「给 INSTANCE_ID 加 pattern」，但 DSH 的工具 schema DSL 是一个
// **封闭子集**（type / oneOf / properties / required / additionalProperties / items /
// enum / const + description/title/default/examples）。实测 `pattern` 与 `minimum`
// 会在 defineTool 注册期直接抛 UNSUPPORTED_SCHEMA，让 11 个工具全部注册失败——
// 代价远大于缺陷本身。因此形状约束放在执行入口：
//   - tools/args.mjs 的 assertInstanceId()：拒绝路径分隔符 / 点段 / 控制字符 / 超长；
//   - core/bridge.mjs 的 requireInstance()：拒绝不存在或形状非法的实例。
// 两处合起来覆盖「schema 加 pattern + 实例校验」的目的，且不会让插件激活失败。
export const INSTANCE_ID = {
  type: 'string',
  required: true,
  description: '实例 ID，来自 bridge_targets（形如 unity:1a2b3c4d5e6f）；路径分隔符与点段会被拒绝。',
}
