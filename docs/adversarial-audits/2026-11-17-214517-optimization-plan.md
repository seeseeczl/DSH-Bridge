# 对抗性审计优化计划：DSH-Bridge（探针 v11 发布前终审）

> 生成时间：2026-11-17 21:45:17
> 项目根目录：`/Users/long/GitHub/DSH-Bridge`
> 关联报告：`docs/adversarial-audits/2026-11-17-214517-audit-report.md`

## 1. 执行摘要

- **审计对象**：通道请求处理/响应发布全链路、`requestHash`、`executionState`、`denied` 快照、CLI 与激活路径
- **Findings 统计**：P0=0 P1=2 P2=5 P3=1（共 8 项，全部已修复）
- **发布建议**：**条件通过** —— 可发布 0.0.3，发布说明需标注两处待真机复核（denied 心跳、V1–V5 回归）
- **执行顺序**：P1 → P2 → P3（本轮已在同一批次内完成）

## 2. 修复与加固任务

| 任务 ID | 优先级 | 来源 | 内容 | 验收标准 | 状态 |
| --- | --- | --- | --- | --- | --- |
| AA-OPT-101 | P1 | AA-SEC-101 | `IsSafeRequestId` 校验 + 非法 id 只归档不进 outbox | 投递 `id="../../x"` 后工程内无越界文件 | ✅ 已修·已验证 |
| AA-OPT-102 | P1 | AA-SEC-102 | CLI install 默认继承 `deniedCapabilities`，仅 `--deny` 覆盖；安装/审计记录 denied | 重装后 `deniedCapabilities` 保持非空 | ✅ 已修（心跳待复核） |
| AA-OPT-103 | P2 | AA-DATA-101 | `requestHash` 改用 `File.ReadAllBytes` 原始字节 | 带 BOM 请求复算一致 | ✅ 已修·已验证 |
| AA-OPT-104 | P2 | AA-LOGIC-101 | 孤儿恢复前检查 outbox 是否已有响应 | 预置真实响应后重载不被覆盖 | ✅ 已修·已验证 |
| AA-OPT-105 | P2 | AA-CLI-101 | `BOOLEAN_FLAGS` 不消费下一个参数 | `install --yes /path` 解析正确 | ✅ 已修·已验证 |
| AA-OPT-106 | P2 | AA-OPS-101 | `activate` 增加 `open -a` 兜底 | 无 Apple Events 权限时仍能激活 | ✅ 已修·已验证 |
| AA-OPT-107 | P2 | AA-STALE-101 | `staleAfterMs` 6000→15000 | 切后台 15s 内不再误判 | ✅ 已修（待重编译生效） |
| AA-OPT-108 | P3 | AA-POLICY-101 | CLI `callCapability` 遵守 denied 快照 | denied 能力经 CLI 也被拒 | ✅ 已修 |

## 3. 测试补强任务

| 任务 ID | 优先级 | 覆盖缺口 | 内容 | 验收标准 |
| --- | --- | --- | --- | --- |
| AA-TEST-101 | P1 | id 穿越无自动化用例 | 离线语义测试：注入 `id` 含 `..` 的信封，断言 `outbox/` 无写入且 `done/` 有归档 | 用例红→绿 |
| AA-TEST-102 | P2 | denied 心跳未覆盖 | 渲染带 `denied` 的探针，断言 `instance.json.deniedCapabilities` 与 `_deniedCapabilities` 一致 | 用例通过 |
| AA-TEST-103 | P3 | CLI 参数解析无用例 | 对 `parseArgs` 抽成可测函数并覆盖 `--yes <path>` / `--deny a,b` | 3 个用例通过 |

## 4. 观测与运维任务

| 任务 ID | 优先级 | 内容 | 验收标准 |
| --- | --- | --- | --- |
| AA-OBS-101 | P2 | `unsafe-request-id` 已进诊断；补一条事件 `request_rejected{code:"unsafe_request_id"}` 便于排障 | 拒绝时可从事件流查到 |
| AA-OBS-102 | P3 | 文档「编辑器后台会停止心跳」写入 DETAIL 的已知限制 | 文档可检索到 |

## 5. 发布门禁

- [x] 所有 P0 任务完成（无）
- [x] 所有 P1 任务完成（101 已验证；102 证据到编译通过，待心跳复核）
- [ ] 编辑器回前台后补跑 `verify-bridge-capabilities.mjs`（V1–V5）
- [ ] `npm run verify` 全绿
- [x] 残留风险已在报告披露（后台失效、可伪造、待复核项）

## 6. 未映射项

无。8 项 finding 全部映射到 `AA-OPT-*`。

**明确不做**：
- 不为文件邮箱引入签名/密钥（凭据同样可读，无意义；见报告「威胁模型」）
- 不尝试在探针侧绕过 Unity 的后台节流（引擎行为，只能靠阈值与前台要求缓解）
