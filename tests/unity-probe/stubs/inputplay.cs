// 输入域（Play Mode 输入）离线 stub。
//
// 这里**故意不定义** UnityEngine.InputSystem.* 的任何类型：
//   - 探针按规格要求全部走反射探测（Type.GetType("UnityEngine.InputSystem.InputSystem, Unity.InputSystem")
//     + AppDomain 兜底），不能引用第三方程序集；
//   - 离线语义环境没有真实 Input System，正好用「未安装包」的确定性降级路径做行为断言；
//   - 若在这里伪造 InputSystem 静态面，语义测试会变成「自证 stub」，反而无法覆盖
//     capability_unavailable / hint 文案 / not_playing 的优先级。
//
// 探针直接引用的 Unity 内置面（UnityEngine.Vector2、EditorApplication.isPlaying/update）
// 已由主 stub（unity-stubs.cs / semantics-stubs.cs）覆盖，本文件无需新增类型。
// 真机上的注入行为由实机验证（verify:live）覆盖，见 v27 能力矩阵。
