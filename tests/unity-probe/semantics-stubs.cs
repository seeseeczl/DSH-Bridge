// 能力语义测试用 Unity stub（配合 tests/unity-probe/capability-semantics.mjs 编译）。
//
// 与 unity-stubs.cs 的区别：
//   - 本文件是**可执行的**假 Unity，用于真实驱动 DSHBridgeProbe.Execute(cap, args)。
//   - 文件读写落到 DSHBridgeStub.ProjectRoot 指定的真实目录，因此可以断言「工程外有没有被写入」。
//   - Selection.activeObject 默认指向一个「假空对象」（模拟 Unity 销毁后的伪 null），用于覆盖空引用路径。
//   - DSHBridgeStub 记录每个能力调用、拒绝事件与日志，供 Node 侧断言。
using System;
using System.Collections.Generic;
using System.IO;

public static class DSHBridgeStub
{
    /// <summary>只用相对路径，避免 macOS /tmp → /private/tmp 的符号链接导致前缀比较失真。</summary>
    public static string ProjectRoot = "dsh-bridge-stub-project";
    public static readonly List<string> FileWrites = new List<string>();
    public static readonly List<string> FileReads = new List<string>();
    public static readonly List<string> MenuCalls = new List<string>();
    public static readonly Dictionary<string, object> State = new Dictionary<string, object>();
    public static readonly List<Dictionary<string, object>> Rejected = new List<Dictionary<string, object>>();
    public static bool SelectionIsNull = false;
    public static bool ScriptCompilationFailedVisible = true;
    public static bool ScriptCompilationFailed = false;
    public static bool IsCompiling = false;
    /// <summary>模拟"DSH 已授权反射执行面"（真实环境由插件配置 + 源码快照决定）。</summary>
    public static bool ReflectAllowed = false;
    public static bool IsUpdating = false;
    public static long ScriptFilesScanned = 0;
    public static string ProjectPathRejected = null;
    /// <summary>被测能力是否声明了「要写工程外」的意图（例如 asset.create 接到 /tmp 绝对路径）。</summary>
    /// <summary>由 Harness 按用例设置，表示"该能力被要求写工程之外"；Reset 不清理它。</summary>
    public static bool DeclaredEscape = false;
    /// <summary>File.WriteAllText 实际落盘目录（用于诊断 cwd 不一致）。</summary>
    public static readonly List<string> DiagnosticWrites = new List<string>();
    /// <summary>假 AssetDatabase 里"存在"的资产路径集合（相对工程根）。</summary>
    public static readonly List<string> Known = new List<string>();
    public static Action<object> OnInvalidMethod = null;

    public static void Reset()
    {
        FileWrites.Clear();
        FileReads.Clear();
        MenuCalls.Clear();
        State.Clear();
        Rejected.Clear();
        SelectionIsNull = false;
        ScriptCompilationFailedVisible = true;
        ScriptCompilationFailed = false;
        IsCompiling = false;
        IsUpdating = false;
        ScriptFilesScanned = 0;
        ProjectPathRejected = null;
        DiagnosticWrites.Clear();
        ReadEscaped = false;
    }

    public static void OnRejected(Dictionary<string, object> payload) => Rejected.Add(payload);

    public static void NoteRead(string path) => FileReads.Add(path);
    public static void NoteWrite(string path) => FileWrites.Add(path);
    /// <summary>
    /// 判定「是否写过工程根之外」。
    /// 三条判据，任一命中即越界：
    ///   ① 能力显式声明了越界意图（Unity 一旦看到 Assets/ 之外的路径就会拒绝或落到工程外）；
    ///   ② 探针把相对路径解析到了工程根之外（例如 ../ 逃逸）；
    ///   ③ 文件确实被写到了工程根之外。
    /// 不用 GetFullPath 处理那条明确的工程内相对路径：mono 的假 cwd 与 Path.GetFullPath
    /// 在 macOS（/tmp → /private/tmp 符号链接）下不一致，会制造假阳性。
    /// </summary>
    /// <summary>读：记录并解析"相对路径落入的实际位置"，用于判断是否读了工程之外的文本。</summary>
    public static void NoteReadFromFile(string path)
    {
        FileReads.Add(path);
        var root = Path.GetFullPath(ProjectRoot).TrimEnd(Path.DirectorySeparatorChar);
        var full = Path.IsPathRooted(path) ? Path.GetFullPath(path) : Path.GetFullPath(Path.Combine(Environment.CurrentDirectory, path));
        if (!full.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.Ordinal)) ReadEscaped = true;
    }

    public static bool ReadEscaped = false;

    public static bool HasWriteOutsideProject()
    {
        if (DeclaredEscape) return true;
        var root = Path.GetFullPath(ProjectRoot).TrimEnd(Path.DirectorySeparatorChar);
        var cwd = Environment.CurrentDirectory;
        foreach (var write in FileWrites)
        {
            if (Path.IsPathRooted(write))
            {
                if (!Path.GetFullPath(write).StartsWith(root + Path.DirectorySeparatorChar, StringComparison.Ordinal)) return true;
                continue;
            }
            var inside = Path.GetFullPath(Path.Combine(ProjectRoot, write));
            if (!inside.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.Ordinal)) return true;
            if (write.StartsWith("Assets" + Path.DirectorySeparatorChar, StringComparison.Ordinal)) continue;
            var underCwd = Path.GetFullPath(Path.Combine(cwd, write));
            if (!underCwd.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.Ordinal)) return true;
        }
        return false;
    }

}

namespace UnityEngine
{
    using System;

    public enum LogType { Error, Assert, Warning, Log, Exception }
    public enum RuntimePlatform { OSXEditor, WindowsEditor, LinuxEditor }

    public delegate void LogCallback(string condition, string stackTrace, LogType type);

    // 关键：复刻 Unity 的「伪 null」语义——对象可能 != null 却为「已销毁」。
    public class Object
    {
        public virtual string name { get; set; } = string.Empty;
        public bool Destroyed { get; set; }
        public static implicit operator bool(Object value) => value != null && !value.Destroyed;
        // 用 ReferenceEquals 判断真正的 null，避免重载递归
        public static bool operator ==(Object a, Object b)
        {
            var aNull = ReferenceEquals(a, null);
            var bNull = ReferenceEquals(b, null);
            if (aNull && bNull) return true;
            if (aNull || bNull) return false;
            if (a.Destroyed && b.Destroyed) return true;
            return ReferenceEquals(a, b);
        }
        public static bool operator !=(Object a, Object b) => !(a == b);
        public override bool Equals(object other) => ReferenceEquals(this, other);
        public override int GetHashCode() => base.GetHashCode();
        public static T Instantiate<T>(T original, Transform parent) where T : Object => original;
    }

    public struct Vector2 { public float x, y; public Vector2(float x, float y) { this.x = x; this.y = y; } }
    public struct Vector3 { public float x, y, z; public Vector3(float x, float y, float z) { this.x = x; this.y = y; this.z = z; } }
    public struct Vector4 { public float x, y, z, w; public Vector4(float x, float y, float z, float w) { this.x = x; this.y = y; this.z = z; this.w = w; } }
    public struct Quaternion
    {
        public float x, y, z, w;
        public Quaternion(float x, float y, float z, float w) { this.x = x; this.y = y; this.z = z; this.w = w; }
        public static Quaternion Euler(float x, float y, float z) => new Quaternion();
    }
    public struct Color
    {
        public float r, g, b, a;
        public Color(float r, float g, float b, float a) { this.r = r; this.g = g; this.b = b; this.a = a; }
    }
    public static class ColorUtility
    {
        public static bool TryParseHtmlString(string html, out Color color) { color = new Color(); return true; }
    }
    public class Texture : Object { }
    public enum PrimitiveType { Sphere, Capsule, Cylinder, Cube, Plane, Quad }

    public class Material : Object
    {
        public Material(Shader shader) { }
        public Shader shader { get; set; }
        public bool HasProperty(string name) => true;
        public Color GetColor(string name) => new Color();
        public void SetColor(string name, Color value) { }
        public float GetFloat(string name) => 0f;
        public void SetFloat(string name, float value) { }
        public Vector4 GetVector(string name) => new Vector4();
        public void SetVector(string name, Vector4 value) { }
        public Texture GetTexture(string name) => null;
        public void SetTexture(string name, Texture value) { }
    }

    public enum ShaderPropertyType { Color, Vector, Float, Range, Texture, Int }
    public class Shader : Object
    {
        public static Shader Find(string name) => new Shader();
        public int GetPropertyCount() => 0;
        public string GetPropertyName(int index) => string.Empty;
        public ShaderPropertyType GetPropertyType(int index) => ShaderPropertyType.Float;
        public int FindPropertyIndex(string name) => -1;
    }

    public class Component : Object
    {
        public Transform transform { get; set; }
        public GameObject gameObject { get; set; }
    }

    public class Transform : Component
    {
        public Transform parent { get; set; }
        public int childCount => 0;
        public Vector3 position { get; set; }
        public Vector3 localPosition { get; set; }
        public Vector3 localScale { get; set; }
        public Vector3 eulerAngles { get; set; }
        public Quaternion rotation { get; set; }
        public Quaternion localRotation { get; set; }
        public void SetParent(Transform parent, bool worldPositionStays) { }
        public Transform GetChild(int index) => this;
    }

    public class GameObject : Object
    {
        public GameObject() { transform = new Transform { gameObject = this }; }
        public GameObject(string name) { this.name = name; transform = new Transform { gameObject = this }; }
        public bool activeSelf => true;
        public bool activeInHierarchy => true;
        public Transform transform { get; set; }
        public bool CompareTag(string tag) => true;
        public T[] GetComponents<T>() => Array.Empty<T>();
        public T GetComponent<T>() => default;
        public Component GetComponent(Type type) => null;
        public Component AddComponent(Type type) => null;
        public void SetActive(bool value) { }
        public static GameObject CreatePrimitive(PrimitiveType type) => new GameObject();
    }

    public static class Application
    {
        public static string dataPath { get { return Path.Combine(DSHBridgeStub.ProjectRoot, "Assets"); } }
        public static string unityVersion => "2022.3.0f1";
        public static string productName => "Fake";
        public static RuntimePlatform platform => RuntimePlatform.OSXEditor;
        public static bool isPlaying => UnityEditor.EditorApplication.isPlaying;
        public static event LogCallback logMessageReceivedThreaded;
        public static void RaiseLog(string c, string s, LogType t) => logMessageReceivedThreaded?.Invoke(c, s, t);
    }

    public static class Debug
    {
        public static void Log(object message) { }
        public static void LogWarning(object message) { }
        public static void LogError(object message) { }
    }
}

namespace UnityEngine.SceneManagement
{
    using UnityEngine;

    public static class SceneManager
    {
        public static Scene GetActiveScene() => new Scene();
        public static int sceneCount => 1;
    }

    public struct Scene
    {
        public string name => "FakeScene";
        public string path => "Assets/Fake.unity";
        public bool IsValid() => true;
        public GameObject[] GetRootGameObjects() => new GameObject[0];
    }
}

namespace UnityEditor
{
    using System.IO;
    using UnityEngine;

    public enum PlayModeStateChange { EnteredEditMode, ExitingEditMode, EnteredPlayMode, ExitingPlayMode }
    public enum ImportAssetOptions { Default, ForceUpdate }

    public static class Selection
    {
        // 默认返回「伪 null」对象：!= null 为 true，但隐式 bool 为 false。
        static readonly UnityEngine.Object Ghost = new UnityEngine.Object { Destroyed = true };
        public static UnityEngine.Object[] objects => new UnityEngine.Object[0];
        public static UnityEngine.Object activeObject
        {
            get { return DSHBridgeStub.SelectionIsNull ? null : Ghost; }
            set { DSHBridgeStub.State["selection"] = value == null ? "null" : "obj"; }
        }
    }

    public class AssetImporter
    {
        public static AssetImporter GetAtPath(string path) => new AssetImporter();
        public string textureType { get; set; } = "Default";
        public bool sRGBTexture { get; set; } = true;
        public bool mipmapEnabled { get; set; } = true;
        public int maxTextureSize { get; set; } = 2048;
        public void SaveAndReimport() { DSHBridgeStub.State["reimported"] = 1; }
    }

    public static class AssetDatabase
    {
        public static List<string> Known => DSHBridgeStub.Known;
        public static string[] FindAssets(string filter) => FindAssets(filter, null);
        public static string[] FindAssets(string filter, string[] searchInFolders)
        {
            var outList = new List<string>();
            foreach (var path in Known)
            {
                if (searchInFolders != null)
                {
                    var ok = false;
                    foreach (var folder in searchInFolders)
                    {
                        if (path.StartsWith(folder.TrimEnd('/') + "/", StringComparison.Ordinal)) { ok = true; break; }
                    }
                    if (!ok) continue;
                }
                if (!string.IsNullOrEmpty(filter) && path.IndexOf(filter, StringComparison.OrdinalIgnoreCase) < 0) continue;
                outList.Add(path);
            }
            return outList.ToArray();
        }
        public static string GUIDToAssetPath(string guid) => guid;
        public static string GetAssetPath(UnityEngine.Object target) => string.Empty;
        public static void Refresh() { }
        public static void Refresh(ImportAssetOptions options) { }
        public static string RenameAsset(string path, string newName)
        {
            if (!IsAssetPath(path)) return "denied_by_unity";
            DSHBridgeStub.State["renamed"] = newName;
            return string.Empty;
        }
        public static string MoveAsset(string path, string newPath) => IsAssetPath(path) ? string.Empty : "denied_by_unity";
        // 与 Unity 行为一致：path 不存在时返回 false（否则用 DeleteAsset("../x") 就能绕过探针自身校验）。
        public static bool DeleteAsset(string path)
        {
            if (!IsAssetPath(path)) return false;
            if (!DSHBridgeStub.Known.Contains(path)) return false;
            DSHBridgeStub.Known.Remove(path);
            DSHBridgeStub.State["deleted"] = path;
            DSHBridgeStub.NoteWrite(path);
            return true;
        }
        public static bool CopyAsset(string path, string newPath) => IsAssetPath(path);
        public static bool IsValidFolder(string path) => path == "Assets";
        public static string CreateFolder(string parent, string name) => parent + "/" + name;
        public static void CreateAsset(UnityEngine.Object asset, string path)
        {
            if (!IsAssetPath(path)) throw new ArgumentException("path must be inside Assets: " + path);
            DSHBridgeStub.NoteWrite(path);
        }
        public static T LoadAssetAtPath<T>(string path) where T : UnityEngine.Object => default;
        static bool IsAssetPath(string path)
        {
            return path == "Assets" || path.StartsWith("Assets/", StringComparison.Ordinal);
        }
    }

    public static class EditorGUIUtility
    {
        public static void PingObject(UnityEngine.Object target) { }
    }

    public static class Undo
    {
        // 记录式替身：让语义测试能断言「是否真的开了组、是否真的回滚了」。
        public static bool Available = true;
        public static int GroupSeq;
        public static int LastOpenedGroup = -1;
        public static bool Reverted;
        public static readonly List<int> RevertedGroups = new List<int>();
        public static void Reset() { Available = true; GroupSeq = 0; LastOpenedGroup = -1; Reverted = false; RevertedGroups.Clear(); }
        public static void RegisterCreatedObjectUndo(UnityEngine.Object target, string name) { }
        public static void DestroyObjectImmediate(UnityEngine.Object target) { }
        public static void RecordObject(UnityEngine.Object target, string name) { }
        public static void IncrementCurrentGroup()
        {
            if (!Available) throw new InvalidOperationException("Undo unavailable in this mode");
            GroupSeq++;
        }
        public static int GetCurrentGroup() => GroupSeq;
        public static void SetCurrentGroupName(string name) { LastOpenedGroup = GroupSeq; }
        public static void RevertAllDownToGroup(int group)
        {
            Reverted = true;
            RevertedGroups.Add(group);
        }
        public static void CollapseUndoOperations(int group) { }
    }

    public static class EditorUtility
    {
        // 复刻「不同版本可见性不同」：不可见时用 public static object 追求，类型不匹配 → 探针应标记 stateKnown=false。
        public static object scriptCompilationFailed
        {
            get
            {
                if (!DSHBridgeStub.ScriptCompilationFailedVisible) return "unavailable";
                return DSHBridgeStub.ScriptCompilationFailed;
            }
        }
        public static void SetDirty(UnityEngine.Object target) { }
    }

    public enum InteractionMode { AutomatedAction, UserAction }

    public static class PrefabUtility
    {
        public static UnityEngine.GameObject SaveAsPrefabAssetAndConnect(UnityEngine.GameObject go, string path, InteractionMode mode)
            => new UnityEngine.GameObject();
        public static UnityEngine.Object InstantiatePrefab(UnityEngine.Object asset) => new UnityEngine.GameObject();
        public static UnityEngine.GameObject SaveAsPrefabAsset(UnityEngine.GameObject go, string path) => new UnityEngine.GameObject();
    }

    [AttributeUsage(AttributeTargets.Class)]
    public sealed class InitializeOnLoadAttribute : Attribute { }

    public static class EditorApplication
    {
        public delegate void CallbackFunction();
        public static event CallbackFunction update;
        public static double timeSinceStartup => 0d;
        public static bool isPlaying { get; set; }
        public static bool isPaused { get; set; }
        public static bool isCompiling => DSHBridgeStub.IsCompiling;
        public static bool isUpdating => DSHBridgeStub.IsUpdating;
        public static event Action<PlayModeStateChange> playModeStateChanged;
        public static bool ExecuteMenuItem(string menuItemPath)
        {
            DSHBridgeStub.MenuCalls.Add(menuItemPath);
            return true;
        }

        // 真实引擎目录由环境变量注入：没有该变量时返回空串，用于验证
        // unity.code.execute 在「引擎未随附 Roslyn」时的失败路径。
        public static string applicationContentsPath =>
            Environment.GetEnvironmentVariable("DSH_BRIDGE_ENGINE_CONTENTS") ?? string.Empty;
        public static void Exit(int code) { DSHBridgeStub.MenuCalls.Add("__Exit"); }
        public static void RaiseUpdate() => update?.Invoke();
        public static void RaisePlayMode(PlayModeStateChange change) => playModeStateChanged?.Invoke(change);
    }
}

namespace UnityEditor.SceneManagement
{
    using UnityEngine.SceneManagement;

    public enum OpenSceneMode { Single, Additive }

    public static class EditorSceneManager
    {
        public static Scene OpenScene(string path, OpenSceneMode mode) => new Scene();
        public static bool SaveScene(Scene scene) => true;
        public static bool SaveScene(Scene scene, string path) => true;
    }

    public class PrefabStage
    {
        public string assetPath => string.Empty;
        public UnityEngine.GameObject prefabContentsRoot => new UnityEngine.GameObject();
        public void ClearDirtiness() { }
    }

    public static class PrefabStageUtility
    {
        public static PrefabStage OpenPrefab(string path) => new PrefabStage();
        public static PrefabStage GetCurrentPrefabStage() => null;
    }

    public static class StageUtility
    {
        public static void GoToMainStage() { }
    }
}

namespace UnityEditor.Compilation
{
    /// <summary>
    /// 真实工程里 UnityEditor.Compilation.Assembly 与 System.Reflection.Assembly 同名。
    /// 少了这个类型，离线编译就发现不了「裸 Assembly 歧义」——那正是探针在真机上编不过的原因。
    /// </summary>
    public class Assembly
    {
        public string name;
        public string outputPath;
        public string[] compiledAssemblyReferences;
    }

    public static class CompilationPipeline
    {
        public static event Action<object> compilationFinished;
        public static void RaiseFinished(object result) => compilationFinished?.Invoke(result);
        public static Assembly[] GetAssemblies() => new Assembly[0];
        public static Assembly[] GetAssemblies(AssembliesType type) => new Assembly[0];
    }

    [Flags]
    public enum AssembliesType
    {
        None = 0,
        Editor = 1,
        EditorAssembly = 2,
        Player = 4,
        PlayerAssembly = 8,
    }
}

// ===== 反射层测试用类型 =====
// 刻意复刻 ASE 的形状：私有字段、多候选名（同一语义在不同版本叫不同名字）、成员重载、可嵌套返回。
namespace DshTestTypes
{
    /// <summary>
    /// 反射层测试类型。全部用静态成员：离线 harness 只有一个进程，取实例句柄会把
    /// 「对象生命周期」引入用例（mono 侧曾因此崩溃），而句柄链路已有 object.find 用例覆盖。
    /// 语义上仍完整复刻 ASE 的形状：私有字段、同义异名、重载、可嵌套返回。
    /// </summary>
    public class GraphSubject
    {
        public static readonly string GraphName = "graph-a";
        private static readonly List<object> m_nodes = new List<object> { "node-1", "node-2" };
    }

    public class MemberSubject
    {
        // 同义异名：CurrentGraph 不存在，OutsideGraph 存在——验证「按序命中并回传 resolvedMember」。
        public static readonly object OutsideGraph = new GraphSubject();
        // ASE 实际依赖的私有字段形状。
        private static readonly string m_mzguiAttribs = "attrib-1";
        private static readonly int m_customAttrCount = 7;
        private static readonly string m_customAttr = "custom-attr";
        public static readonly string PublicName = "public-name";

        public static Dictionary<string, object> DeepStatic()
        {
            var level3 = new List<object> { 1L, 2L, 3L };
            var level2 = new Dictionary<string, object>();
            level2["items"] = level3;
            level2["label"] = "l2";
            var level1 = new Dictionary<string, object>();
            level1["child"] = level2;
            level1["name"] = "l1";
            return level1;
        }

        public static string EchoStatic(string value) { return "echo:" + value; }

        /// <summary>混合类型键：1 与 "1" 编码成同一字符串，用于验证「不静默丢数据」。</summary>
        public static Dictionary<object, object> MixedKeyDict()
        {
            var d = new Dictionary<object, object>();
            d[1] = "int-key";
            d["1"] = "string-key";
            return d;
        }

        /// <summary>构造指定层数的嵌套字典，用于触发 DescribeEx 的 depth 截断。</summary>
        public static object DeepNest(int depth)
        {
            object current = "leaf";
            for (var i = 0; i < depth; i++)
            {
                var wrapper = new Dictionary<string, object>();
                wrapper["n"] = current;
                current = wrapper;
            }
            return current;
        }

        /// <summary>构造超宽结构（groups × perGroup），用于触发 DescribeEx 的 nodes 预算截断。</summary>
        public static Dictionary<string, object> WideNest(int groups, int perGroup)
        {
            var root = new Dictionary<string, object>();
            for (var g = 0; g < groups; g++)
            {
                var list = new List<object>();
                for (var i = 0; i < perGroup; i++) list.Add(i);
                root["g" + g] = list;
            }
            return root;
        }

        /// <summary>构造超长列表，用于触发 DescribeEx 的 items 截断。</summary>
        public static List<object> BigList(int count)
        {
            var list = new List<object>();
            for (var i = 0; i < count; i++) list.Add(i);
            return list;
        }
        public static string OverloadStatic(int value) { return "int:" + value; }
        public static string OverloadStatic(string value) { return "string:" + value; }
    }
}
