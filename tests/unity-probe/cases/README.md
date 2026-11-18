# 域级语义用例（`tests/unity-probe/cases/`）

`capability-semantics.mjs` 在编译 harness 前会加载本目录所有 `.mjs`，把每个模块默认导出的
**C# 语句片段**拼进生成的 `Harness.Main`（位于 `results` 局部变量作用域内）。

## 约定

- 一个域一个模块：`graphics.mjs`、`physics.mjs`、`uitk.mjs`、`inputplay.mjs`、`editormeta.mjs`、`docs.mjs`。
- 默认导出字符串；片段直接使用 harness 已有 helper：
  `Run(results, name, cap, args)`、`RunAuthorized(...)`（打开反射授权）、
  `Args(pairs...)`、`Dict(pairs...)`、`List(items...)`、`ExpectEscape(bool)`、`Str(dict, key)`。
- 用例名全局唯一，建议用能力域前缀（如 `graphics.pipeline-builtin`），断言侧按名字取行。
- 只断言探针返回的结构与 probe 侧行为；不要依赖真实 Unity 的完整 API（stub 只覆盖最小面）。
- 用例必须覆盖：主路径、缺失参数/错误码、危险/授权路径（如该域有闸门）。
- 片段不要包含 `// =====` 大标题之外的内容；异常用例由 harness 的 `Run` 统一捕获。
