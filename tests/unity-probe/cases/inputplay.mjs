// 输入域（Play Mode 输入）语义用例。
//
// 离线环境没有真实 Input System，因此主路径覆盖两件确定的事：
//   1. 统一前置：未进入 Play Mode → not_playing，不允许做任何注入尝试；
//   2. 进入 Play Mode 但包缺失 → capability_unavailable + 安装 hint，绝不伪称成功。
// 参数校验（invalid_argument）在这些用例里先于后端探测，所以无包时也能断言。
// sequence 的纯 wait 序列不依赖 Input System，可完整验证 EditorApplication.update
// 驱动的异步推进与 status 状态机（含 sequence_lost 边界）。
//
// 用例名全局唯一，统一 inputplay. 前缀。

export default `
// ===== 输入域（Play Mode 输入）：前置 / 参数校验 / 未安装包降级 / 序列异步 =====
Action inputPlayOn = delegate { UnityEditor.EditorApplication.isPlaying = true; };
Action inputPlayOff = delegate { UnityEditor.EditorApplication.isPlaying = false; };

// ---- 统一前置：未进入 Play Mode 时 5 项能力一律 not_playing ----
Run(results, "inputplay.mouse-not-playing", "unity.input.mouse", new Dictionary<string, object>(), inputPlayOff);
Run(results, "inputplay.keyboard-not-playing", "unity.input.keyboard", Args("key", "space"), inputPlayOff);
Run(results, "inputplay.type_text-not-playing", "unity.input.type_text", Args("text", "hi"), inputPlayOff);
Run(results, "inputplay.device-not-playing", "unity.input.device", Args("action", "list"), inputPlayOff);
Run(results, "inputplay.sequence-not-playing", "unity.input.sequence",
    Args("action", "run", "steps", List()), inputPlayOff);

// ---- 参数校验：Play Mode 下参数错优先报 invalid_argument（先于包探测）----
Run(results, "inputplay.mouse-invalid-action", "unity.input.mouse", Args("action", "teleport"), inputPlayOn);
Run(results, "inputplay.mouse-invalid-position", "unity.input.mouse",
    Args("action", "move", "position", List(1L)), inputPlayOn);
Run(results, "inputplay.mouse-move-needs-position-or-delta", "unity.input.mouse",
    Args("action", "move"), inputPlayOn);
Run(results, "inputplay.keyboard-missing-key", "unity.input.keyboard", new Dictionary<string, object>(), inputPlayOn);
Run(results, "inputplay.keyboard-invalid-hold", "unity.input.keyboard",
    Args("key", "space", "holdMs", 5000L), inputPlayOn);
Run(results, "inputplay.type_text-missing-text", "unity.input.type_text",
    new Dictionary<string, object>(), inputPlayOn);
Run(results, "inputplay.type_text-too-long", "unity.input.type_text",
    Args("text", new string('x', 501)), inputPlayOn);
Run(results, "inputplay.device-invalid-action", "unity.input.device", Args("action", "zap"), inputPlayOn);
Run(results, "inputplay.device-add-missing-layout", "unity.input.device", Args("action", "add"), inputPlayOn);
Run(results, "inputplay.device-remove-missing-selector", "unity.input.device",
    Args("action", "remove"), inputPlayOn);
Run(results, "inputplay.device-set-missing-control-path", "unity.input.device",
    Args("action", "set", "deviceId", 1L), inputPlayOn);
Run(results, "inputplay.sequence-empty-steps", "unity.input.sequence",
    Args("action", "run", "steps", List()), inputPlayOn);
var inputPlayManySteps = new List<object>();
for (var inputPlayStepIndex = 0; inputPlayStepIndex < 51; inputPlayStepIndex++)
    inputPlayManySteps.Add(Args("op", "wait", "waitMs", 0L));
Run(results, "inputplay.sequence-too-many-steps", "unity.input.sequence",
    Args("action", "run", "steps", inputPlayManySteps), inputPlayOn);
Run(results, "inputplay.sequence-wait-too-long", "unity.input.sequence",
    Args("action", "run", "steps", List(Args("op", "wait", "waitMs", 1001L))), inputPlayOn);
Run(results, "inputplay.sequence-bad-op", "unity.input.sequence",
    Args("action", "run", "steps", List(Args("op", "teleport"))), inputPlayOn);
Run(results, "inputplay.sequence-status-unknown", "unity.input.sequence",
    Args("action", "status", "seqId", "inputplay-missing"), inputPlayOn);

// ---- 未安装 Input System：Play Mode 下必须确定性降级，绝不伪称成功 ----
Run(results, "inputplay.mouse-no-inputsystem", "unity.input.mouse",
    Args("action", "move", "position", List(10L, 20L)), inputPlayOn);
Run(results, "inputplay.keyboard-no-inputsystem", "unity.input.keyboard",
    Args("key", "space"), inputPlayOn);
Run(results, "inputplay.type_text-no-inputsystem", "unity.input.type_text",
    Args("text", "abc"), inputPlayOn);
Run(results, "inputplay.device-no-inputsystem", "unity.input.device",
    Args("action", "list"), inputPlayOn);
Run(results, "inputplay.sequence-key-no-inputsystem", "unity.input.sequence",
    Args("action", "run", "steps", List(Args("op", "key", "key", "space"))), inputPlayOn);
Run(results, "inputplay.sequence-mouse-no-inputsystem", "unity.input.sequence",
    Args("action", "run", "steps", List(Args("op", "mouse", "action", "move", "position", List(1L, 2L)))),
    inputPlayOn);

// ---- sequence 异步主路径：纯 wait 序列不依赖 Input System，验证 update 驱动与状态机 ----
var inputPlayWaitSteps = List(
    Args("op", "wait", "waitMs", 0L),
    Args("op", "wait", "waitMs", 0L));
Run(results, "inputplay.sequence-run-wait-only", "unity.input.sequence",
    Args("action", "run", "seqId", "inputplay-seq-wait", "steps", inputPlayWaitSteps), inputPlayOn);
// 手动驱动 EditorApplication.update：探针在 run 时订阅 update，逐帧推进序列。
UnityEditor.EditorApplication.RaiseUpdate();
UnityEditor.EditorApplication.RaiseUpdate();
UnityEditor.EditorApplication.RaiseUpdate();
UnityEditor.EditorApplication.RaiseUpdate();
Run(results, "inputplay.sequence-status-done", "unity.input.sequence",
    Args("action", "status", "seqId", "inputplay-seq-wait"), inputPlayOn);

// ---- seqId 冲突：运行中的序列不能被同名 run 覆盖 ----
Run(results, "inputplay.sequence-run-long-wait", "unity.input.sequence",
    Args("action", "run", "seqId", "inputplay-seq-dup",
        "steps", List(Args("op", "wait", "waitMs", 1000L))), inputPlayOn);
Run(results, "inputplay.sequence-duplicate-running", "unity.input.sequence",
    Args("action", "run", "seqId", "inputplay-seq-dup",
        "steps", List(Args("op", "wait", "waitMs", 0L))), inputPlayOn);

// 复位 Play Mode，避免污染其它域的用例（stub 的 isPlaying 不随 Reset 清理）。
UnityEditor.EditorApplication.isPlaying = false;
`
