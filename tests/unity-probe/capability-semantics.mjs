// 能力语义测试驱动：把渲染后的探针与 semantics-stubs.cs 一起编译成可执行程序，
// 真实调用 DSHBridgeProbe.Execute(cap, args)，观察文件系统副作用与返回载荷。
//
// 用法：node tests/unity-probe/capability-semantics.mjs
// 退出码非 0 表示探针存在越权/异常行为；同时把失败项打印出来（AA-OPT-007 的「修复前必须红」依据）。
import { execFile, spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { renderProbeFiles } from '../../packages/dsh-bridge/adapters/unity/probe.template.mjs'
import { assertProbeToolchain, CSC_COMMAND, resolveMonoCommand } from './toolchain.mjs'
import { collectExtraStubs } from './extra-stubs.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const run = promisify(execFile)

/** 由 Node 侧覆盖的输出文件名；每次运行独立，避免读到脏数据。 */
const RESULT_FILE = 'semantics-results.json'

/**
 * 域级用例模块（tests/unity-probe/cases/*.mjs）：默认导出 C# 语句字符串。
 * 片段会被拼接进 harness 的 `Main`，因此可以直接使用 `results` 局部变量与
 * `Run/RunAuthorized/Args/Dict/List` 等 helper。约定见 cases/README.md。
 */
async function loadDomainCases() {
  const dir = join(here, 'cases')
  let entries = []
  try {
    entries = (await readdir(dir)).filter((name) => name.endsWith('.mjs')).sort()
  } catch {
    return ''
  }
  const parts = []
  for (const name of entries) {
    const module = await import(`${pathToFileURL(join(dir, name)).href}?v=${Date.now()}`)
    const snippet = module.default ?? module.cases
    if (typeof snippet !== 'string' || snippet.trim() === '') {
      throw new Error(`域级用例模块 ${name} 必须默认导出非空 C# 片段字符串`)
    }
    parts.push(`// ---- 域级用例：${name} ----\n${snippet.trim()}`)
  }
  return parts.join('\n\n')
}

function harnessSource(extraCases = '') {
  return `// 自动生成的驱动：仅调用探针 public/static 入口，不修改探针实现。
using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using DSHBridge;

/// <summary>把探针返回的业务错误码包装成测试可见的异常。</summary>
public class ProbeRejection : Exception
{
    public readonly string Code;
    public readonly string Detail;
    public ProbeRejection(string code, string message) : this(code, message, null) { }
    public ProbeRejection(string code, string message, string detail) : base(message)
    {
        Code = code ?? "unknown";
        Detail = detail ?? string.Empty;
    }
}

public static class Harness
{
    public static void Main(string[] argv)
    {
        if (Environment.GetEnvironmentVariable("DSH_BRIDGE_TRACE") == "1") Console.Error.WriteLine("[boot] harness start");
        var projectRoot = argv[0];
        var outFile = argv[1];
        UnityEditor.AssetDatabase.Known.Add("Assets/Thing.prefab");
        // 把进程 cwd 切到工程根：mono 的 File.WriteAllText(相对路径) 相对 Environment.CurrentDirectory，
        // 这样探针的"相对工程根"写入与真实 Unity 行为一致，判定结果才可信。
        Directory.CreateDirectory(Path.Combine(projectRoot, "Assets"));
        Environment.CurrentDirectory = projectRoot;
        DSHBridgeStub.ProjectRoot = Environment.CurrentDirectory;
        var results = new List<Dictionary<string, object>>();

        RunAuthorized(results, "api.members-empty-selection", "unity.api.members", new Dictionary<string, object>());
        RunAuthorized(results, "api.invoke-empty-selection", "unity.api.invoke", Args(new object[] { "member", "GetType" }));
        RunAuthorized(results, "api.invoke-missing-member", "unity.api.invoke", Args(new object[] { "type", "System.String" }));
        ExpectEscape(false); Run(results, "asset.read-absolute", "unity.asset.read", Args(new object[] { "path", "/etc/passwd" }));
        Run(results, "asset.read-parent-escape", "unity.asset.read", Args(new object[] { "path", "../../../etc/hosts" }));
        Run(results, "asset.read-empty", "unity.asset.read", new Dictionary<string, object>());
        ExpectEscape(true); Run(results, "asset.create-parent-escape", "unity.asset.create",
            Args(new object[] { "kind", "text", "path", "../../../../tmp/dsh-bridge-escape.txt", "content", "escaped" }));
        ExpectEscape(true); Run(results, "asset.create-absolute", "unity.asset.create",
            Args(new object[] { "kind", "text", "path", "/tmp/dsh-bridge-absolute.txt", "content", "absolute" }));
        Run(results, "asset.create-inside-project", "unity.asset.create",
            Args(new object[] { "kind", "text", "path", "Assets/Generated/inside.txt", "content", "ok" }));
        ExpectEscape(true); Run(results, "search.content-absolute-folder", "unity.search.content",
            Args(new object[] { "query", "root", "folders", List("/etc"), "extensions", List(".passwd") }));
        Run(results, "search.content-budget", "unity.search.content",
            Args(new object[] { "query", "x", "limit", 5L }));
        RunAuthorized(results, "menu.execute", "unity.menu.execute", Args(new object[] { "path", "Assets/Reimport All" }));
        RunAuthorized(results, "asset.delete-inside", "unity.asset.delete", Args(new object[] { "path", "Assets/Thing.prefab" }));
        ExpectEscape(true); RunAuthorized(results, "asset.delete-outside-real", "unity.asset.delete", Args(new object[] { "path", "Thing.prefab" }));
        ExpectEscape(true); RunAuthorized(results, "asset.delete-outside", "unity.asset.delete", Args(new object[] { "path", "../Outside.prefab" }));
        Run(results, "reflect.invoke-unauthorized", "unity.reflect.invoke",
            Args(new object[] { "type", "System.String", "method", "IsNullOrEmpty", "args", List("x") }));
        RunAuthorized(results, "reflect.invoke-static", "unity.reflect.invoke",
            Args(new object[] { "type", "UnityEditor.EditorApplication", "method", "ExecuteMenuItem", "args", List("Assets/Reimport All") }));
        RunAuthorized(results, "api.invoke-static-hook", "unity.api.invoke",
            Args(new object[] { "type", "UnityEditor.EditorApplication", "member", "ExecuteMenuItem", "args", List("Assets/Reimport All") }));
        RunAuthorized(results, "api.invoke-private-member", "unity.api.invoke",
            Args(new object[] { "type", "System.Diagnostics.Process", "member", "GetCurrentProcess" }));
        ExpectEscape(true); RunAuthorized(results, "importer.set-outside", "unity.importer.set", ImporterSetArgs());

        RunAuthorized(results, "asset.refresh-while-compiling", "unity.asset.refresh",
            Args(new object[] { "force", true }), delegate { DSHBridgeStub.IsCompiling = true; });

        // ===== 新增能力语义：反射成员访问 / 批量事务 / 代码执行 =====
        // 全部走静态成员：用例不依赖对象句柄，结果才可重复（句柄链路由 object.find 与真机 V2 覆盖）。
        var subjectType = Dict("type", "DshTestTypes.MemberSubject");

        RunAuthorized(results, "reflect.member-private-static", "unity.reflect.invoke",
            Args(new object[] { "target", subjectType, "member", "m_mzguiAttribs" }));
        RunAuthorized(results, "reflect.member-multi-candidate", "unity.reflect.invoke",
            Args(new object[] { "target", subjectType, "member", "CurrentGraph",
                "candidates", List("OutsideGraph", "m_mainGraphInstance") }));
        RunAuthorized(results, "reflect.member-missing-suggests", "unity.reflect.invoke",
            Args(new object[] { "target", subjectType, "member", "m_custom" }));
        RunAuthorized(results, "reflect.member-overload-argtypes", "unity.reflect.invoke",
            Args(new object[] { "target", subjectType, "member", "OverloadStatic",
                "argTypes", List("System.String"), "args", List("x") }));
        RunAuthorized(results, "reflect.member-nested", "unity.reflect.invoke",
            Args(new object[] { "target", subjectType, "member", "DeepStatic" }));
        Run(results, "reflect.member-unauthorized", "unity.reflect.invoke",
            Args(new object[] { "target", subjectType, "member", "m_mzguiAttribs" }));

        RunAuthorized(results, "api.batch-success", "unity.api.batch", Args(new object[] {
            "calls", List(
                Args(new object[] { "target", subjectType, "member", "EchoStatic", "args", List("a") }),
                Args(new object[] { "target", subjectType, "member", "PublicName" })),
            "stopOnError", true, "rollbackOnError", true }));
        RunAuthorized(results, "api.batch-rollback", "unity.api.batch", Args(new object[] {
            "calls", List(
                Args(new object[] { "target", subjectType, "member", "EchoStatic", "args", List("a") }),
                Args(new object[] { "target", subjectType, "member", "EchoStatic", "args", List("b") }),
                Args(new object[] { "target", subjectType, "member", "NoSuchMemberAtAll" })),
            "stopOnError", true, "rollbackOnError", true,
            "onError", List(Args(new object[] { "target", subjectType, "member", "PublicName" })) }));

        // 显式 return：两个后端（mono-mcs / roslyn）语义一致。
        RunAuthorized(results, "code.execute-simple", "unity.code.execute",
            Args(new object[] { "code", "return (40 + 2) * 2;" }));
        // 强制 Mono 自带编译器，用于观察该后端的独立可用性（auto 模式失败会回退 Roslyn 掩盖原因）。
        RunAuthorized(results, "code.execute-mcs-only", "unity.code.execute",
            Args(new object[] { "code", "return (40 + 2) * 2;", "backend", "mono-mcs" }));

        // ===== AA-TEST-004：混合类型键必须显式暴露，不能静默丢数据 =====
        RunAuthorized(results, "reflect.dict-key-collision", "unity.reflect.invoke",
            Args(new object[] { "target", subjectType, "member", "MixedKeyDict" }));

        // ===== AA-TEST-001：三种截断 reason =====
        RunAuthorized(results, "reflect.truncate-depth", "unity.reflect.invoke",
            Args(new object[] { "target", subjectType, "member", "DeepNest", "args", List(8L) }));
        RunAuthorized(results, "reflect.truncate-items", "unity.reflect.invoke",
            Args(new object[] { "target", subjectType, "member", "BigList", "args", List(600L) }));
        RunAuthorized(results, "reflect.truncate-nodes", "unity.reflect.invoke",
            Args(new object[] { "target", subjectType, "member", "WideNest", "args", List(45L, 500L) }));

        // ===== AA-TEST-003：stopOnError=false 时 failedAt 为首个失败，failures 记录全部 =====
        RunAuthorized(results, "api.batch-multi-failure", "unity.api.batch", Args(new object[] {
            "calls", List(
                Args(new object[] { "target", subjectType, "member", "EchoStatic", "args", List("a") }),
                Args(new object[] { "target", subjectType, "member", "NoSuchOne" }),
                Args(new object[] { "target", subjectType, "member", "EchoStatic", "args", List("b") }),
                Args(new object[] { "target", subjectType, "member", "NoSuchTwo" })),
            "stopOnError", false, "rollbackOnError", false }));

        // ===== AA-TEST-002：references 越界拒绝 / backend 强制 Roslyn / async 拒绝 =====
        RunAuthorized(results, "code.execute-refs-escape", "unity.code.execute",
            Args(new object[] { "code", "return 1;", "references", List("/etc/hosts") }));
        RunAuthorized(results, "code.execute-backend-roslyn", "unity.code.execute",
            Args(new object[] { "code", "return 1;", "backend", "roslyn" }));
        RunAuthorized(results, "code.execute-async-rejected", "unity.code.execute",
            Args(new object[] { "code", "var tcs = new System.Threading.Tasks.TaskCompletionSource<object>(); return tcs.Task;" }));

        // ===== AA-TEST-005：诊断列表有界（连续多次调用后仍应远小于上限） =====
        // 次数刻意保持很小：每次调用都会真编译一遍脚本，太多会让语义测试慢一个数量级。
        for (var repeat = 0; repeat < 5; repeat++)
        {
            // 无引擎工具链时该能力会抛 code_execute_unavailable；本用例只关心诊断条数是否有界。
            try { Submit("unity.code.execute", Args(new object[] { "code", "return " + repeat + ";" })); }
            catch (System.Exception) { }
        }

        // ===== 域级能力用例（tests/unity-probe/cases/*.mjs 注入）=====
__DOMAIN_CASES_PLACEHOLDER__

        var payload = new Dictionary<string, object>();
        payload["writes"] = DSHBridgeStub.FileWrites;
        payload["reads"] = DSHBridgeStub.FileReads;
        payload["writesOutsideProject"] = DSHBridgeStub.HasWriteOutsideProject();
        payload["menuCalls"] = DSHBridgeStub.MenuCalls;
        payload["rejected"] = DSHBridgeStub.Rejected;
        // ===== 问题 1：坏文件不得线性拖慢队列（10 个坏文件 + 1 个正常请求）=====
        var pollProbe = new Dictionary<string, object>();
        {
            var inboxDir = DSHBridgeProbe.__bridge_inbox_dir__();
            for (var i = 0; i < 10; i++)
                // 故意写非 JSON：解析失败即被判定为坏文件（无需引号，避免多层转义）。
                File.WriteAllText(Path.Combine(inboxDir, "aaa_broken_" + i + ".json"), "not-json-at-all");
            var goodId = DSHBridgeProbe.__bridge_enqueue_probe__("unity.editor.status", new Dictionary<string, object>());
            DSHBridgeProbe.__bridge_poll__();
            var afterFirst = DSHBridgeProbe.__bridge_take_raw__(goodId);
            DSHBridgeProbe.__bridge_poll__();
            var afterSecond = DSHBridgeProbe.__bridge_take_raw__(goodId);
            pollProbe["doneAfterFirstPoll"] = afterFirst != null;
            pollProbe["doneAfterSecondPoll"] = afterSecond != null;
            pollProbe["inboxLeft"] = (long)Directory.GetFiles(inboxDir, "*.json").Length;
        }
        payload["pollRobustness"] = pollProbe;

        // ===== 问题 2：executionState 四种场景 =====
        var execStates = new Dictionary<string, object>();
        {
            DSHBridgeStub.ReflectAllowed = true;
            DSHBridgeProbe.__bridge_authorize__(true);
            var normal = DSHBridgeProbe.__bridge_submit_raw__("unity.editor.status", new Dictionary<string, object>());
            execStates["executed"] = Str(normal, "executionState");

            var badNonce = DSHBridgeProbe.__bridge_submit_envelope__(
                DSHBridgeProbe.__bridge_probe_envelope__("req_bad_nonce", "unity.editor.status", "wrong-nonce", 0));
            execStates["pairing"] = Str(badNonce, "executionState");
            execStates["pairingCode"] = Str(badNonce["error"] as Dictionary<string, object>, "code");

            var expired = DSHBridgeProbe.__bridge_submit_envelope__(
                DSHBridgeProbe.__bridge_probe_envelope__("req_expired", "unity.editor.status", null, 1));
            execStates["expired"] = Str(expired, "executionState");

            DSHBridgeStub.ReflectAllowed = false;
            DSHBridgeProbe.__bridge_authorize__(false);
            var denied = DSHBridgeProbe.__bridge_submit_envelope__(
                DSHBridgeProbe.__bridge_probe_envelope__("req_denied", "unity.api.batch", null, 0));
            execStates["denied"] = Str(denied, "executionState");
            execStates["deniedCode"] = Str(denied["error"] as Dictionary<string, object>, "code");

            DSHBridgeStub.ReflectAllowed = true;
            DSHBridgeProbe.__bridge_authorize__(true);
        }
        payload["executionStates"] = execStates;

        // ===== 归属证据：响应携带 requestHash（16 位十六进制）=====
        var hashProbe = new Dictionary<string, object>();
        {
            var resp = DSHBridgeProbe.__bridge_submit_raw__("unity.editor.status", new Dictionary<string, object>());
            var hash = Str(resp, "requestHash");
            hashProbe["present"] = hash != null;
            hashProbe["length"] = hash == null ? 0L : (long)hash.Length;
            hashProbe["hex"] = hash != null && System.Text.RegularExpressions.Regex.IsMatch(hash, "^[0-9a-f]+$");
        }
        payload["requestHash"] = hashProbe;

        // ===== AA-TEST-101：id 含路径穿越时必须拒绝，且不留越界文件 =====
        var traversalProbe = new Dictionary<string, object>();
        {
            var outboxDir = DSHBridgeProbe.__bridge_outbox_dir__();
            var escaped = Path.Combine(Path.GetDirectoryName(outboxDir), "__escape_probe.json");
            if (File.Exists(escaped)) File.Delete(escaped);
            var evil = DSHBridgeProbe.__bridge_probe_envelope__("../../__escape_probe", "unity.editor.status", null, 0);
            var resp = DSHBridgeProbe.__bridge_submit_envelope__(evil);
            traversalProbe["escapedFileExists"] = File.Exists(escaped);
            traversalProbe["responseWritten"] = resp != null;
            if (File.Exists(escaped)) File.Delete(escaped);
        }
        payload["idTraversal"] = traversalProbe;

        // ===== 探针侧回收超龄 outbox 响应（含无人消费的 .rejected.json）=====
        var sweepProbe = new Dictionary<string, object>();
        {
            var outboxDir = DSHBridgeProbe.__bridge_outbox_dir__();
            var stale = Path.Combine(outboxDir, "req_stale_probe.rejected.json");
            var fresh = Path.Combine(outboxDir, "req_fresh_probe.json");
            File.WriteAllText(stale, "stale-marker");
            File.WriteAllText(fresh, "fresh-marker");
            // 把 stale 的写入时间推到 20 分钟前（超过 10 分钟保留期）
            File.SetLastWriteTimeUtc(stale, System.DateTime.UtcNow.AddMinutes(-20));
            DSHBridgeProbe.__bridge_sweep_outbox__();
            sweepProbe["staleRemoved"] = !File.Exists(stale);
            sweepProbe["freshKept"] = File.Exists(fresh);
            if (File.Exists(fresh)) File.Delete(fresh);
        }
        payload["outboxSweep"] = sweepProbe;

        // ===== 问题 3：同 id 第二次投递返回 duplicate_id =====
        var duplicateProbe = new Dictionary<string, object>();
        {
            var dupId = "req_dup_probe";
            var firstDup = DSHBridgeProbe.__bridge_submit_envelope__(
                DSHBridgeProbe.__bridge_probe_envelope__(dupId, "unity.editor.status", null, 0));
            var secondDup = DSHBridgeProbe.__bridge_submit_envelope__(
                DSHBridgeProbe.__bridge_probe_envelope__(dupId, "unity.editor.status", null, 0));
            duplicateProbe["firstOk"] = firstDup != null && firstDup.ContainsKey("ok") && firstDup["ok"] is bool && (bool)firstDup["ok"];
            duplicateProbe["secondCode"] = Str(secondDup["error"] as Dictionary<string, object>, "code");
            duplicateProbe["secondState"] = Str(secondDup, "executionState");
        }
        payload["duplicateId"] = duplicateProbe;

        payload["diagnosticsCount"] = DSHBridgeProbe.__bridge_diagnostics_count__();
        payload["results"] = results;
        File.WriteAllText(outFile, MiniJson.Serialize(payload), new UTF8Encoding(false));
    }

    // 注意：params object[] 会把 string 元素逐个装箱，不能用 (string) 强转。
    static Dictionary<string, object> Args(params object[] pairs)
    {
        var d = new Dictionary<string, object>();
        for (var i = 0; i + 1 < pairs.Length; i += 2) d[(string)pairs[i]] = pairs[i + 1];
        return d;
    }

    /// <summary>构造嵌套对象参数（target 用）。</summary>
    static Dictionary<string, object> Dict(params object[] pairs) { return Args(pairs); }

    /// <summary>用例准备：直接走一次完整链路并返回 data，不做断言记录。</summary>
    static object Submit(string cap, Dictionary<string, object> args)
    {
        // 注入的授权替身读 DSHBridgeStub.ReflectAllowed，两个开关都要设。
        DSHBridgeStub.ReflectAllowed = true;
        DSHBridgeProbe.__bridge_authorize__(true);
        return DSHBridgeProbe.__bridge_submit__(cap, args);
    }

    /// <summary>从成员访问结果里取出对象句柄（DescribeEx 对未知对象返回 $handle）。</summary>
    static string ExtractHandle(object data)
    {
        var d = data as Dictionary<string, object>;
        if (d == null || !d.ContainsKey("result")) return null;
        var result = d["result"] as Dictionary<string, object>;
        if (result == null || !result.ContainsKey("$handle")) return null;
        return result["$handle"] as string;
    }

    static void ExpectEscape(bool value) { DSHBridgeStub.DeclaredEscape = value; }

    /// <summary>从响应字典里取字符串字段（探针的 GetString 是私有的）。</summary>
    static string Str(Dictionary<string, object> d, string key)
    {
        if (d == null || !d.ContainsKey(key)) return null;
        return d[key] as string;
    }

    /// <summary>模拟 DSH 侧授权：把反射执行面打开（对应插件配置 allowDangerous）。</summary>
    static void EnableReflection(bool value)
    {
        // 命令行里带上授权参数，才能让静态构造的"首次判定"为 true；随后用反射开关覆盖。
        DSHBridgeStub.ReflectAllowed = value;
        DSHBridgeProbe.__bridge_authorize__(value);
    }

    static Dictionary<string, object> ImporterSetArgs()
    {
        var changes = new Dictionary<string, object>();
        changes["textureType"] = "Sprite";
        var d = new Dictionary<string, object>();
        d["path"] = "../../../etc/hosts";
        d["changes"] = changes;
        return d;
    }

    static List<object> List(params object[] items)
    {
        var l = new List<object>();
        foreach (var item in items) l.Add(item);
        return l;
    }

    static public List<object> InvalidMethods = new List<object>();

    public static void StaticRecordInvalidMethod(object method)
    {
        InvalidMethods.Add(method == null ? "<null>" : method.ToString());
    }

    static void Run(List<Dictionary<string, object>> sink, string name, string cap, Dictionary<string, object> args)
    {
        Run(sink, name, cap, args, null);
    }

    static void RunAuthorized(List<Dictionary<string, object>> sink, string name, string cap, Dictionary<string, object> args)
    {
        Run(sink, name, cap, args, true);
    }

    static void RunAuthorized(List<Dictionary<string, object>> sink, string name, string cap, Dictionary<string, object> args, Action setup)
    {
        Run(sink, name, cap, args, true, setup);
    }

    /// <summary>setup 在 Reset() 之后执行，用于设置那些 Reset 会清掉的 stub 状态。</summary>
    static void Run(List<Dictionary<string, object>> sink, string name, string cap, Dictionary<string, object> args, Action setup)
    {
        Run(sink, name, cap, args, false, setup);
    }

    static void Run(List<Dictionary<string, object>> sink, string name, string cap, Dictionary<string, object> args, bool authorized)
    {
        Run(sink, name, cap, args, authorized, null);
    }

    static void Run(List<Dictionary<string, object>> sink, string name, string cap, Dictionary<string, object> args, bool authorized, Action setup)
    {
        if (Environment.GetEnvironmentVariable("DSH_BRIDGE_TRACE") == "1") Console.Error.WriteLine("[run] " + name);
        DSHBridgeStub.OnInvalidMethod = StaticRecordInvalidMethod;
        DSHBridgeStub.Reset();
        DSHBridgeStub.DeclaredEscape = false;
        DSHBridgeProbe.__bridge_authorize__(false);
        // 授权状态与 DeclaredEscape 一样，只由用例显式设置；不能用静态字段默认值，
        // 否则会依赖 argparse/env 的实际取值，测试变得不可控。
        DSHBridgeStub.ReflectAllowed = authorized;
        DSHBridgeProbe.__bridge_authorize__(authorized);
        if (setup != null) setup();
        var row = new Dictionary<string, object>();
        row["name"] = name;
        row["cap"] = cap;
        row["writes"] = new List<object>();
        row["menuCalls"] = new List<object>();
        row["readPaths"] = new List<object>();
        try
        {
            var data = DSHBridgeProbe.__bridge_submit__(cap, args);
            row["ok"] = true;
            row["data"] = data;
        }
        catch (Exception e)
        {
            row["ok"] = false;
            // 探针的 KnownError 把业务错误码放在 public readonly 字段 Code 上；其它异常用 CLR 类型名。
            var codeField = e.GetType().GetField("Code", System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);
            row["errorCode"] = codeField != null ? System.Convert.ToString(codeField.GetValue(e)) : e.GetType().Name;
            row["errorType"] = e.GetType().Name;
            row["errorMessage"] = e.Message;
            var detailField = e.GetType().GetField("Detail", System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Instance);
            row["errorDetail"] = detailField != null ? System.Convert.ToString(detailField.GetValue(e)) : null;
        }
        // 判定必须在 Reset 之前做：Reset 会清空 DeclaredEscape / cwd 基准。
        row["declaredEscape"] = DSHBridgeStub.DeclaredEscape;
        row["writesOutsideProject"] = DSHBridgeStub.HasWriteOutsideProject();
        row["writes"] = new List<object>(DSHBridgeStub.FileWrites);
        row["menuCalls"] = new List<object>(DSHBridgeStub.MenuCalls);
        row["readPaths"] = new List<object>(DSHBridgeStub.FileReads);
        sink.Add(row);
    }
}
`.replace('__DOMAIN_CASES_PLACEHOLDER__', extraCases)
}

async function compile(workDir) {
  // 审计 P2.6：csc/mono 缺失时显式失败；只有 DSH_BRIDGE_SKIP_PROBE=1 才跳过。
  await assertProbeToolchain({ requireMono: true })
  const stubsPath = join(workDir, 'semantics-stubs.cs')
  const harnessPath = join(workDir, 'harness.cs')
  const exePath = join(workDir, 'semantics.exe')
  const extraStubs = await collectExtraStubs()
  const extraCases = await loadDomainCases()
  // 探针的 Execute 是 private static；测试副本里注入一个公开转发入口，模板本身保持 private。
  const anchor = '        static object Execute(string cap, Dictionary<string, object> args)'
  // 拆分后 Execute 位于 Security 文件；跨 partial class 文件（同一类）注入照样可用。
  const rendered = renderProbeFiles({ probeVersion: 'semantics' })
  const securityFile = rendered.files.find((item) => item.content.includes(anchor))
  if (!securityFile) {
    throw new Error('探针模板结构已变化：找不到 Execute 定义锚点，请同步 capability-semantics.mjs')
  }
  const source = securityFile.content
  const injected = [
    '        // 走完整链路：写 inbox → HandleFile（含授权闸门）→ 读 outbox，避免测试绕过安全闸门。',
    '        public static object __bridge_submit__(string cap, Dictionary<string, object> args)',
    '        {',
    '            var id = "req_test_" + Guid.NewGuid().ToString("N").Substring(0, 8);',
    '            var req = new Dictionary<string, object>();',
    '            req["v"] = 1L; req["id"] = id; req["instanceId"] = _instanceId;',
    '            req["bootId"] = _bootId; req["nonce"] = _nonce; req["cap"] = cap; req["args"] = args;',
    '            req["issuedAt"] = NowMs(); req["deadlineMs"] = 30000L;',
    '            var inboxFile = Path.Combine(_inboxDir, id + ".json");',
    '            WriteAtomic(inboxFile, MiniJson.Serialize(req));',
    '            HandleFile(inboxFile);',
    '            var outFile = Path.Combine(_outboxDir, id + ".json");',
    '            if (!File.Exists(outFile)) return null;',
    '            var resp = MiniJson.Parse(File.ReadAllText(outFile)) as Dictionary<string, object>;',
    '            File.Delete(outFile);',
    '            if (resp == null) return null;',
    '            var ok = resp.ContainsKey("ok") && resp["ok"] is bool && (bool)resp["ok"];',
    '            if (!ok)',
    '            {',
    '                var err = resp.ContainsKey("error") ? resp["error"] as Dictionary<string, object> : null;',
    '                throw new ProbeRejection(GetString(err, "code"), GetString(err, "message"), GetString(err, "detail"));',
    '            }',
    '            return resp.ContainsKey("data") ? resp["data"] : null;',
    '        }',
    '',
    '        public static int __bridge_diagnostics_count__() { return _scriptingDiagnostics.Count; }',
    '',
    '        public static void __bridge_poll__() { Poll(); }',
    '',
    '        public static Dictionary<string, object> __bridge_submit_raw__(string cap, Dictionary<string, object> args)',
    '        {',
    '            var id = "req_test_" + Guid.NewGuid().ToString("N").Substring(0, 8);',
    '            var req = new Dictionary<string, object>();',
    '            req["v"] = 1L; req["id"] = id; req["instanceId"] = _instanceId;',
    '            req["bootId"] = _bootId; req["nonce"] = _nonce; req["cap"] = cap; req["args"] = args;',
    '            req["issuedAt"] = NowMs(); req["deadlineMs"] = 30000L;',
    '            var inboxFile = Path.Combine(_inboxDir, id + ".json");',
    '            WriteAtomic(inboxFile, MiniJson.Serialize(req));',
    '            HandleFile(inboxFile);',
    '            return TakeResponseRaw(id);',
    '        }',
    '',
    '        public static Dictionary<string, object> __bridge_submit_envelope__(Dictionary<string, object> req)',
    '        {',
    '            var id = GetString(req, "id");',
    '            var inboxFile = Path.Combine(_inboxDir, id + ".json");',
    '            WriteAtomic(inboxFile, MiniJson.Serialize(req));',
    '            HandleFile(inboxFile);',
    '            return TakeResponseRaw(id);',
    '        }',
    '',
    '        public static string __bridge_inbox_dir__() { return _inboxDir; }',
    '',
    '        public static string __bridge_outbox_dir__() { return _outboxDir; }',
    '',
    '        public static void __bridge_sweep_outbox__() { SweepStaleOutbox(); }',
    '',
    '        public static string __bridge_request_hash__(string text) { return RequestHashOfBytes(System.Text.Encoding.UTF8.GetBytes(text)); }',

    '',
    '        public static string __bridge_enqueue_probe__(string cap, Dictionary<string, object> args)',
    '        {',
    '            var id = "req_poll_" + Guid.NewGuid().ToString("N").Substring(0, 8);',
    '            WriteAtomic(Path.Combine(_inboxDir, id + ".json"), MiniJson.Serialize(__bridge_probe_envelope__(id, cap, null, NowMs())));',
    '            return id;',
    '        }',
    '',
    '        public static Dictionary<string, object> __bridge_probe_envelope__(string id, string cap, string nonceOverride, long issuedAt)',
    '        {',
    '            var req = new Dictionary<string, object>();',
    '            req["v"] = 1L; req["id"] = id; req["instanceId"] = _instanceId;',
    '            req["bootId"] = _bootId;',
    '            req["nonce"] = nonceOverride == null ? _nonce : nonceOverride;',
    '            req["cap"] = cap; req["args"] = new Dictionary<string, object>();',
    '            req["issuedAt"] = issuedAt; req["deadlineMs"] = 30000L;',
    '            return req;',
    '        }',
    '',
    '        public static Dictionary<string, object> __bridge_take_raw__(string id) { return TakeResponseRaw(id); }',
    '',
    '        static Dictionary<string, object> TakeResponseRaw(string id)',
    '        {',
    '            var outFile = Path.Combine(_outboxDir, id + ".json");',
    '            if (!File.Exists(outFile)) return null;',
    '            var resp = MiniJson.Parse(File.ReadAllText(outFile)) as Dictionary<string, object>;',
    '            File.Delete(outFile);',
    '            return resp;',
    '        }',
    '',
    '        public static void __bridge_authorize__(bool enabled)',
    '        {',
    '            _reflectEnabled = enabled;',
    '        }',
    '',
    '        // 测试替身：真实环境的授权来自 argv 快照，测试里改用 stub 标志，避免被进程参数污染。',
    '        static bool __AuthorizedByArgvOverride__() { return DSHBridgeStub.ReflectAllowed; }',
    '',
    anchor,
  ].join('\n')
  const withAnchor = source.replace(anchor, injected)
  if (withAnchor === source) throw new Error('无法注入测试入口：Execute 锚点替换失败')
  // 授权替身位于主文件（AuthorizedByArgv 所在文件）；partial 文件共享同一类，注入后照样能调用 Execute。
  const AUTH_OLD = 'return _reflectEnabled.HasValue ? _reflectEnabled.Value : AuthorizedByArgv();'
  const AUTH_NEW = 'return __AuthorizedByArgvOverride__();'
  const mainFile = rendered.files[0]
  if (!mainFile.content.includes(AUTH_OLD)) throw new Error('无法注入授权替身：ReflectAuthorized 结构已变化')
  const probePaths = []
  for (const item of rendered.files) {
    const target = join(workDir, item.file)
    let content = item.content
    if (item.file === securityFile.file) content = withAnchor
    if (item.file === mainFile.file) content = content.replace(AUTH_OLD, AUTH_NEW)
    await writeFile(target, content, 'utf8')
    probePaths.push(target)
  }
  await writeFile(stubsPath, await readFile(join(here, 'semantics-stubs.cs'), 'utf8'), 'utf8')
  await writeFile(harnessPath, harnessSource(extraCases), 'utf8')
  const { stdout, stderr } = await run(CSC_COMMAND, [
    '-nologo', '-define:UNITY_EDITOR', '-target:exe', '-warn:0',
    `-out:${exePath}`, stubsPath, ...extraStubs.files, ...probePaths, harnessPath,
  ]).catch((error) => ({ stdout: error.stdout ?? '', stderr: error.stderr ?? String(error) }))
  return { exePath, output: `${stdout}${stderr}` }
}

/** 探测真实能力名：探针的 Execute 分发里出现过的 cap 字符串。 */
export async function declaredCapabilities() {
  const { readProbeTemplateText } = await import('../../packages/dsh-bridge/adapters/unity/probe.template.mjs')
  const source = readProbeTemplateText()
  const caps = new Set()
  for (const match of source.matchAll(/"cap == "(unity\.[\w.]+)"/g)) caps.add(match[1])
  for (const match of source.matchAll(/cap == "(unity\.[\w.]+)"/g)) caps.add(match[1])
  return [...caps].sort()
}

export async function runSemantics({ env } = {}) {
  const workDir = await mkdtemp(join(tmpdir(), 'dsh-bridge-semantics-'))
  const projectRoot = join(workDir, 'Project')
  await mkdir(join(projectRoot, 'Assets'), { recursive: true })
  await writeFile(join(projectRoot, 'Assets', 'Thing.prefab'), 'x', 'utf8')
  const { exePath, output } = await compile(workDir)
  if (!output.includes('semantics.exe') && !(await readFile(exePath).then(() => true).catch(() => false))) {
    throw new Error(`探针语义测试编译失败：\n${output}`)
  }
  const runner = await resolveMonoCommand()
  const resultPath = join(workDir, RESULT_FILE)
  const child = spawn(runner, [exePath, projectRoot, resultPath], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: env ? { ...process.env, ...env } : process.env,
  })
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr += chunk })
  const exitCode = await new Promise((resolve) => child.on('close', resolve))
  if (exitCode !== 0) throw new Error(`探针语义测试进程退出 ${exitCode}：\n${stderr}`)
  const payload = JSON.parse(await readFile(resultPath, 'utf8'))
  if (!process.env.DSH_BRIDGE_KEEP_WORKDIR) await rm(workDir, { recursive: true, force: true })
  return { payload, projectRoot, workDir }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { payload, workDir } = await runSemantics()
  console.log(JSON.stringify(payload, null, 2))
}

export { readdir }
