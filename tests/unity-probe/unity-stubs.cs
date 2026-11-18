// 仅用于离线语法检查：提供探针引用到的 Unity API 最小签名，不代表真实运行时语义。
using System;

namespace UnityEngine
{
    public enum LogType { Error, Assert, Warning, Log, Exception }
    public enum RuntimePlatform { OSXEditor, WindowsEditor, LinuxEditor }

    public delegate void LogCallback(string condition, string stackTrace, LogType type);

    public class Object
    {
        public string name { get; set; } = string.Empty;
        public static implicit operator bool(Object value) => value != null;
        public static T Instantiate<T>(T original, Transform parent) where T : Object => original;
        public static void DestroyImmediate(Object target) { }
        public static T[] FindObjectsOfType<T>() where T : Object => new T[0];
    }

    public class ScriptableObject : Object { }

    public struct Vector2 { public float x, y; public Vector2(float x, float y) { this.x = x; this.y = y; } }
    public struct Vector3 { public float x, y, z; public Vector3(float x, float y, float z) { this.x = x; this.y = y; this.z = z; } public Vector3 normalized => this; }
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

    // ===== 截图能力（unity.screenshot.capture）所需的最小签名 =====
    public enum RenderTextureFormat { ARGB32, Default }
    public enum TextureFormat { RGB24, RGBA32 }
    public enum RenderTextureReadWrite { Default, Linear, sRGB }
    public struct Rect
    {
        public float x, y, width, height;
        public Rect(float x, float y, float width, float height) { this.x = x; this.y = y; this.width = width; this.height = height; }
    }
    public class RenderTexture : Texture
    {
        public static RenderTexture active { get; set; }
        public int width { get; set; }
        public int height { get; set; }
        public static RenderTexture GetTemporary(int width, int height, int depth, RenderTextureFormat format) => new RenderTexture();
        public static RenderTexture GetTemporary(int width, int height, int depth, RenderTextureFormat format, RenderTextureReadWrite readWrite) => new RenderTexture();
        public static void ReleaseTemporary(RenderTexture tex) { }
    }
    public class Texture2D : Texture
    {
        public Texture2D(int width, int height, TextureFormat format, bool mipChain) { }
        public void ReadPixels(Rect source, int destX, int destY) { }
        public void Apply() { }
        public void SetPixels(Color[] colors) { }
        public byte[] EncodeToPNG() => System.Array.Empty<byte>();
    }

    // ===== 垂直域第二批（animation / vfx / ui / sprite / texture）所需的最小签名 =====
    public class Behaviour : Component
    {
        public bool enabled { get; set; } = true;
    }

    public enum AnimatorControllerParameterType { Float, Int, Bool, Trigger }

    public class AnimatorControllerParameter
    {
        public string name;
        public AnimatorControllerParameterType type;
    }

    public class RuntimeAnimatorController : Object { }

    public struct AnimatorStateInfo
    {
        public float normalizedTime;
        public float length;
        public int fullPathHash;
        public bool IsName(string name) => false;
    }

    public class Animator : Behaviour
    {
        public RuntimeAnimatorController runtimeAnimatorController { get; set; }
        public float speed { get; set; } = 1f;
        public AnimatorControllerParameter[] parameters => new AnimatorControllerParameter[0];
        public float GetFloat(string name) => 0f;
        public void SetFloat(string name, float value) { }
        public int GetInteger(string name) => 0;
        public void SetInteger(string name, int value) { }
        public bool GetBool(string name) => false;
        public void SetBool(string name, bool value) { }
        public void SetTrigger(string name) { }
        public AnimatorStateInfo GetCurrentAnimatorStateInfo(int layerIndex) => new AnimatorStateInfo();
        public bool IsInTransition(int layerIndex) => false;
    }

    public class ParticleSystem : Behaviour
    {
        public struct MainModule
        {
            public bool loop;
        }
        public bool isPlaying => false;
        public bool isPaused => false;
        public bool isStopped => true;
        public int particleCount => 0;
        public float time => 0f;
        public float duration => 1f;
        public MainModule main => new MainModule();
        public void Play() { }
        public void Pause() { }
        public void Stop() { }
        public void Clear() { }
    }

    public enum RenderMode { ScreenSpaceOverlay, ScreenSpaceCamera, WorldSpace }


    // ===== 原生交互（enabled 窗口/输入注入）所需的最小签名 =====
    public enum EventType { KeyDown, KeyUp, MouseDown, MouseUp, MouseDrag, ScrollWheel, Layout, Repaint }
    public enum EventModifiers { None, Shift, Control, Alt, Command }
    public enum KeyCode { None, A, B, C, Space, Return, Escape, Tab, Delete, Backspace, LeftArrow, RightArrow, UpArrow, DownArrow }

    public class Event
    {
        public EventType type;
        public KeyCode keyCode;
        public char character;
        public int button;
        public Vector2 mousePosition;
        public Vector2 delta;
        public EventModifiers modifiers;
    }

    public class GUIContent
    {
        public string text;
    }

    public static class Resources
    {
        public static T[] FindObjectsOfTypeAll<T>() where T : Object => new T[0];
    }

    public class Canvas : Behaviour
    {
        public RenderMode renderMode { get; set; }
        public int sortingOrder { get; set; }
        public bool isRootCanvas => true;
    }

    public class Sprite : Object
    {
        public Rect rect;
        public float pixelsPerUnit;
    }


    public class Camera : Object
    {
        public static Camera main => null;
        public static Camera[] allCameras => System.Array.Empty<Camera>();
        public RenderTexture targetTexture { get; set; }
        public void Render() { }
    }

    public class Material : Object
    {
        public Material(Shader shader) { }
        public Shader shader { get; set; }
        public bool HasProperty(string name) => false;
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
        public Transform parent => null;
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
        public GameObject() { }
        public GameObject(string name) { this.name = name; }
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


    // ===== 垂直域第一批（graphics / profiler / physics）所需的最小签名 =====
    public enum ColorSpace { Gamma, Linear }

    public static class QualitySettings
    {
        public static string[] names => new string[0];
        public static ColorSpace activeColorSpace => ColorSpace.Gamma;
        public static int GetQualityLevel() => 0;
        public static void SetQualityLevel(int index, bool applyExpensiveChanges) { }
    }

    public static class RenderSettings
    {
        public static UnityEngine.Rendering.AmbientMode ambientMode { get; set; }
        public static Color ambientLight { get; set; }
        public static bool fog { get; set; }
        public static Color fogColor { get; set; }
        public static float fogDensity { get; set; }
        public static Material skybox { get; set; }
    }

    public static class SystemInfo
    {
        public static string graphicsDeviceName => "Fake GPU";
        public static int graphicsMemorySize => 1024;
        public static int graphicsShaderLevel => 50;
    }

    public static class Physics
    {
        public static Vector3 gravity { get; set; } = new Vector3(0f, -9.81f, 0f);
        public static int defaultSolverIterations { get; set; } = 6;
        public static int defaultSolverVelocityIterations { get; set; } = 1;
        public static bool queriesHitTriggers { get; set; } = true;
        public static float bounceThreshold { get; set; } = 2f;
        public static bool Raycast(Vector3 origin, Vector3 direction, out RaycastHit hit, float maxDistance)
        {
            hit = new RaycastHit();
            return false;
        }
    }

    public struct RaycastHit
    {
        public Vector3 point;
        public Vector3 normal;
        public float distance;
        public Collider collider;
    }

    public class Collider : Component { public bool enabled { get; set; } = true; }

    public static class Application
    {
        public static string dataPath => "/tmp/fake/Assets";
        public static string unityVersion => "2022.3.0f1";
        public static string productName => "Fake";
        public static RuntimePlatform platform => RuntimePlatform.OSXEditor;
        public static int targetFrameRate { get; set; } = -1;
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


namespace UnityEngine.Rendering
{
    public enum AmbientMode { Skybox, Trilight, Flat, Custom }

    public class RenderPipelineAsset : UnityEngine.Object { }

    public static class GraphicsSettings
    {
        public static RenderPipelineAsset currentRenderPipeline => null;
    }
}

namespace UnityEngine.Profiling
{
    public static class Profiler
    {
        public static bool enabled { get; set; }
        public static bool supported => true;
        public static long GetTotalAllocatedMemoryLong() => 0L;
        public static long GetTotalReservedMemoryLong() => 0L;
        public static long GetMonoUsedSizeLong() => 0L;
        public static long GetMonoHeapSizeLong() => 0L;
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
        public GameObject[] GetRootGameObjects() => Array.Empty<GameObject>();
    }
}

namespace UnityEditor
{
    using UnityEngine;

    public enum PlayModeStateChange { EnteredEditMode, ExitingEditMode, EnteredPlayMode, ExitingPlayMode }

    public enum ImportAssetOptions { Default, ForceUpdate, ForceSynchronousImport }

    public class SceneView
    {
        public static SceneView lastActiveSceneView => null;
        public Camera camera => null;
        public void Repaint() { }
    }

    // ===== 生产管线（能力补全第 3 项）所需的最小签名 =====
    public enum BuildTarget { OSXUniversal, OSXIntel64, StandaloneWindows64, StandaloneLinux64, Android, iOS, WebGL }
    public enum BuildOptions { None }
    public struct BuildPlayerOptions
    {
        public string[] scenes;
        public string locationPathName;
        public BuildTarget target;
        public BuildOptions options;
    }
    public static class EditorUserBuildSettings
    {
        public static BuildTarget activeBuildTarget => BuildTarget.OSXUniversal;
    }
    public class EditorBuildSettingsScene
    {
        public string path;
        public bool enabled;
        public EditorBuildSettingsScene(string path, bool enabled) { this.path = path; this.enabled = enabled; }
    }
    public static class EditorBuildSettings
    {
        public static EditorBuildSettingsScene[] scenes { get; set; } = new EditorBuildSettingsScene[0];
    }
    public static class Lightmapping
    {
        public static bool isRunning => false;
        public static bool BakeAsync() => true;
        public static void Cancel() { }
    }
    public static class BuildPipeline
    {
        public static UnityEditor.Build.Reporting.BuildReport BuildPlayer(BuildPlayerOptions options)
            => new UnityEditor.Build.Reporting.BuildReport();
    }

    public static class Selection
    {
        public static UnityEngine.Object[] objects => Array.Empty<UnityEngine.Object>();
        public static UnityEngine.Object activeObject { get; set; }
        public static UnityEngine.GameObject activeGameObject => null;
    }

    public enum SpriteImportMode { None, Single, Multiple, Polygon }

    public enum TextureImporterType { Default, NormalMap, Sprite, Cursor, Cookie, Lightmap, SingleChannel }

    public class TextureImporter : AssetImporter
    {
        public SpriteImportMode spriteImportMode { get; set; }
        public float spritePixelsPerUnit { get; set; } = 100f;
        public TextureImporterType textureType { get; set; }
        public int maxTextureSize { get; set; } = 2048;
        public TextureImporterFormat? textureCompression { get; set; }
    }

    public enum TextureImporterFormat { Automatic, RGBA32 }


    public class EditorWindow : ScriptableObject
    {
        public GUIContent titleContent => new GUIContent();
        public bool hasFocus => false;
        public Rect position { get; set; }
        public static EditorWindow focusedWindow => null;
        public void Focus() { }
        public void Repaint() { }
        public void SendEvent(Event e) { }
    }

    public class AssetImporter
    {
        public static AssetImporter GetAtPath(string path) => new TextureImporter();
        public void SaveAndReimport() { }
    }

    public static class AssetDatabase
    {
        public static Object[] LoadAllAssetsAtPath(string path) => new Object[0];
        public static void ImportAsset(string path) { }
        public static void ImportAsset(string path, ImportAssetOptions options) { }
        public static string[] FindAssets(string filter) => Array.Empty<string>();
        public static string[] FindAssets(string filter, string[] searchInFolders) => Array.Empty<string>();
        public static string GUIDToAssetPath(string guid) => string.Empty;
        public static string GetAssetPath(UnityEngine.Object target) => string.Empty;
        public static void Refresh() { }
        public static void Refresh(ImportAssetOptions options) { }
        public static string RenameAsset(string path, string newName) => string.Empty;
        public static string MoveAsset(string path, string newPath) => string.Empty;
        public static bool DeleteAsset(string path) => true;
        public static bool CopyAsset(string path, string newPath) => true;
        public static bool IsValidFolder(string path) => false;
        public static string CreateFolder(string parent, string name) => string.Empty;
        public static void CreateAsset(UnityEngine.Object asset, string path) { }
        public static T LoadAssetAtPath<T>(string path) where T : UnityEngine.Object => default;
    }

    public static class EditorGUIUtility
    {
        public static void PingObject(UnityEngine.Object target) { }
    }

    public static class Undo
    {
        public static void RegisterCreatedObjectUndo(UnityEngine.Object target, string name) { }
        public static void DestroyObjectImmediate(UnityEngine.Object target) { }
        public static void RecordObject(UnityEngine.Object target, string name) { }
        public static void IncrementCurrentGroup() { }
        public static int GetCurrentGroup() => 0;
        public static void SetCurrentGroupName(string name) { }
        public static void RevertAllDownToGroup(int group) { }
        public static void CollapseUndoOperations(int group) { }
    }

    public static class EditorUtility
    {
        public static bool scriptCompilationFailed => false;
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
        public static bool isCompiling => false;
        public static bool isUpdating => false;
        public static event Action<PlayModeStateChange> playModeStateChanged;
        public static bool ExecuteMenuItem(string menuItemPath) => true;
        public static string applicationContentsPath =>
            Environment.GetEnvironmentVariable("DSH_BRIDGE_ENGINE_CONTENTS") ?? string.Empty;
        public static void RaiseUpdate() => update?.Invoke();
        public static void RaisePlayMode(PlayModeStateChange change) => playModeStateChanged?.Invoke(change);
    }
}

namespace UnityEditor.Build.Reporting
{
    public enum BuildResult { Unknown, Succeeded, Failed, Cancelled }

    public struct BuildSummary
    {
        public BuildResult result;
        public ulong totalSize;
        public System.TimeSpan totalTime;
    }

    public class BuildReport
    {
        public BuildSummary summary => new BuildSummary();
    }
}

namespace UnityEditor.PackageManager
{
    public enum StatusCode { InProgress, Success, Failure, NotFound }
    public enum PackageSource { Registry, Embedded, Local, Git, BuiltIn, Unknown }

    public class Error
    {
        public string message;
    }

    public class PackageInfo
    {
        public string name;
        public string displayName;
        public string version;
        public PackageSource source;
        public static PackageInfo[] GetAllRegisteredPackages() => new PackageInfo[0];
    }

    public abstract class Request
    {
        public bool IsCompleted => true;
        public StatusCode Status => StatusCode.Success;
        public Error Error => null;
    }

    public class AddRequest : Request
    {
        public PackageInfo Result => null;
    }

    public class RemoveRequest : Request { }

    public class ListRequest : Request
    {
        public PackageInfo[] Result => new PackageInfo[0];
    }

    public static class Client
    {
        public static AddRequest Add(string identifier) => new AddRequest();
        public static RemoveRequest Remove(string name) => new RemoveRequest();
        public static ListRequest List(bool offlineMode) => new ListRequest();
    }
}

namespace UnityEditor.AI
{
    public static class NavMeshBuilder
    {
        public static void BuildNavMesh() { }
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
}

namespace UnityEditor.SceneManagement
{
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
