# 域级 stub（`tests/unity-probe/stubs/`）

`npm run check:probe` 与 `tests/unity-probe/capability-semantics.mjs` 会把本目录下所有 `.cs`
和主 stub（`../unity-stubs.cs` / `../semantics-stubs.cs`）一起交给 `csc` 编译。

## 约定

1. **一个域一个文件**：`graphics.cs`、`physics.cs`、`uitk.cs`、`inputplay.cs`、`editormeta.cs`、`docs.cs`。
   并行开发时各自只改自己的文件，避免共享文件冲突。
2. **不得重复定义主 stub 已有的类型**：主 stub 已覆盖 `UnityEngine`（Object/GameObject/Transform/
   Component/Physics/Collider/RenderSettings/QualitySettings/…）、`UnityEditor` 的常用面。
   重复定义会 `CS0101`，修法是删掉自己文件里的重复类型。
3. **只 stub 探针直接 `new` / 直接调用的 API**。第三方包类型（URP `Volume`、Input System、
   UI Toolkit 的 PanelSettings 等）在真机上可能不存在，探针必须走反射；反射调用不需要 stub。
4. stub 只服务于离线编译；行为由 `capability-semantics.mjs` 里的域级用例断言。
