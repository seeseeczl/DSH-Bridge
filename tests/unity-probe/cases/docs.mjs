// 文档 / 签名域（docs）语义用例片段。
//
// 由 capability-semantics.mjs 注入 harness 的 Main：
//   - 可直接使用 Run / RunAuthorized / Args / Dict / List 与局部变量 results；
//   - 用例名全局唯一，统一用 docs. 前缀；
//   - 失败由 Run 统一捕获成 errorCode，断言侧按名字取行。
//
// 覆盖策略：
//   1. unity.reflect.signature：对离线 stub 类型断言真实反射签名（主路径/重载/可见性/继承/泛型/错误建议）；
//   2. unity.docs.search / get：无真实引擎文档时断言「确定性降级」与参数校验；
//   3. 当 Node 侧通过 DSH_BRIDGE_ENGINE_CONTENTS 注入伪造文档目录时（docs-semantics.test.mjs），
//      再执行主路径用例（index 解析、HTML 提取、8KB 截断、中文文档、缺失页建议）。
export default `
// ===== 文档 / 签名域（docs）：程序集精确签名 + 官方 ScriptReference =====

// ---- unity.reflect.signature：主路径 / 重载 / 成员过滤 ----
Run(results, "docs.signature-main", "unity.reflect.signature",
    Args(new object[] { "type", "DshTestTypes.DocsSignatureSubject" }));
Run(results, "docs.signature-nonpublic", "unity.reflect.signature",
    Args(new object[] { "type", "DshTestTypes.DocsSignatureSubject", "includeNonPublic", true }));
Run(results, "docs.signature-member", "unity.reflect.signature",
    Args(new object[] { "type", "DshTestTypes.DocsSignatureSubject", "member", "Echo" }));
Run(results, "docs.signature-shortname", "unity.reflect.signature",
    Args(new object[] { "type", "DocsSignatureSubject" }));
Run(results, "docs.signature-inherited", "unity.reflect.signature",
    Args(new object[] { "type", "DshTestTypes.DocsSignatureSubject", "includeInherited", true }));
Run(results, "docs.signature-kind-interface", "unity.reflect.signature",
    Args(new object[] { "type", "DshTestTypes.DocsSignatureContract" }));
Run(results, "docs.signature-kind-enum", "unity.reflect.signature",
    Args(new object[] { "type", "DshTestTypes.DocsSignatureMode" }));
Run(results, "docs.signature-kind-struct", "unity.reflect.signature",
    Args(new object[] { "type", "DshTestTypes.DocsSignatureStruct" }));
Run(results, "docs.signature-ambiguous", "unity.reflect.signature",
    Args(new object[] { "type", "DocsAmbiguousSubject" }));
Run(results, "docs.signature-format-generic", "unity.reflect.signature",
    Args(new object[] { "type", "DshTestTypes.DocsSignatureSubject", "member", "Numbers" }));
Run(results, "docs.signature-format-generic-method", "unity.reflect.signature",
    Args(new object[] { "type", "DshTestTypes.DocsSignatureSubject", "member", "Generic" }));
Run(results, "docs.signature-limit", "unity.reflect.signature",
    Args(new object[] { "type", "DshTestTypes.DocsSignatureSubject", "limit", 1L }));

// ---- unity.reflect.signature：错误路径（参数/类型/成员不存在都要可诊断）----
Run(results, "docs.signature-missing-type", "unity.reflect.signature", new Dictionary<string, object>());
Run(results, "docs.signature-type-missing", "unity.reflect.signature",
    Args(new object[] { "type", "NoSuchDocsTypeAtAll" }));
Run(results, "docs.signature-type-suggests", "unity.reflect.signature",
    Args(new object[] { "type", "DocsSignatureSubjec" }));
Run(results, "docs.signature-member-missing", "unity.reflect.signature",
    Args(new object[] { "type", "DshTestTypes.DocsSignatureSubject", "member", "EchoStat" }));
// 私有成员在默认 includeNonPublic=false 下不可见；错误详情要提示打开开关。
Run(results, "docs.signature-member-hidden", "unity.reflect.signature",
    Args(new object[] { "type", "DshTestTypes.DocsSignatureSubject", "member", "_hidden" }));

// ---- unity.docs.search / get：参数校验（先校验参数，再探测文档，保证离线确定性）----
Run(results, "docs.search-missing-query", "unity.docs.search", new Dictionary<string, object>());
Run(results, "docs.search-bad-language", "unity.docs.search",
    Args(new object[] { "query", "Rigidbody", "language", "../en" }));
Run(results, "docs.search-language-missing", "unity.docs.search",
    Args(new object[] { "query", "Rigidbody", "language", "zz_ZZ" }));
// fake 文档环境里 ja/ScriptReference 存在但缺 docdata/index.json；离线环境同样缺文档 → 都是 docs_unavailable。
Run(results, "docs.search-language-no-index", "unity.docs.search",
    Args(new object[] { "query", "Rigidbody", "language", "ja" }));
Run(results, "docs.get-missing-symbol", "unity.docs.get", new Dictionary<string, object>());
Run(results, "docs.get-path-escape", "unity.docs.get",
    Args(new object[] { "symbol", "../../etc/passwd" }));
Run(results, "docs.get-bad-language", "unity.docs.get",
    Args(new object[] { "symbol", "Rigidbody", "language", "en/../../x" }));
Run(results, "docs.get-language-missing", "unity.docs.get",
    Args(new object[] { "symbol", "Rigidbody", "language", "zz_ZZ" }));

// ---- 有伪造文档目录时的主路径（由 docs-semantics.test.mjs 注入环境变量）----
var docsEngineRoot = Environment.GetEnvironmentVariable("DSH_BRIDGE_ENGINE_CONTENTS");
if (!string.IsNullOrEmpty(docsEngineRoot))
{
    Run(results, "docs.search-main", "unity.docs.search", Args(new object[] { "query", "Rigidbody" }));
    Run(results, "docs.search-limit", "unity.docs.search", Args(new object[] { "query", "Rigidbody", "limit", 1L }));
    // limit 硬上限 100：超大 limit 必须被夹紧而不是真返回上万条。
    Run(results, "docs.search-limit-clamp", "unity.docs.search", Args(new object[] { "query", "Rigidbody", "limit", 5000L }));
    Run(results, "docs.search-multi-token", "unity.docs.search",
        Args(new object[] { "query", "Rigidbody AddForce" }));
    // 索引里的 "../escape" 是恶意 id：加载时必须过滤，不能出现在搜索结果里。
    Run(results, "docs.search-unsafe-filtered", "unity.docs.search", Args(new object[] { "query", "escape" }));
    Run(results, "docs.get-main", "unity.docs.get", Args(new object[] { "symbol", "Rigidbody" }));
    Run(results, "docs.get-raw", "unity.docs.get",
        Args(new object[] { "symbol", "Rigidbody", "includeRaw", true }));
    Run(results, "docs.get-force-page", "unity.docs.get", Args(new object[] { "symbol", "AddForce" }));
    // 精确成员页 id（真实文档里方法页是 Rigidbody.AddForce）。
    Run(results, "docs.get-member-exact", "unity.docs.get", Args(new object[] { "symbol", "Rigidbody.AddForce" }));
    Run(results, "docs.get-long-truncated", "unity.docs.get", Args(new object[] { "symbol", "DocsLong" }));
    Run(results, "docs.get-not-found", "unity.docs.get", Args(new object[] { "symbol", "Rigido" }));
    Run(results, "docs.get-page-missing", "unity.docs.get", Args(new object[] { "symbol", "Physics" }));
    Run(results, "docs.get-zh", "unity.docs.get",
        Args(new object[] { "symbol", "Rigidbody", "language", "zh_CN" }));
}
`
