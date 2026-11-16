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
    }

    public class ScriptableObject : Object { }

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

    public static class Application
    {
        public static string dataPath => "/tmp/fake/Assets";
        public static string unityVersion => "2022.3.0f1";
        public static string productName => "Fake";
        public static RuntimePlatform platform => RuntimePlatform.OSXEditor;
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
        public GameObject[] GetRootGameObjects() => Array.Empty<GameObject>();
    }
}

namespace UnityEditor
{
    using UnityEngine;

    public enum PlayModeStateChange { EnteredEditMode, ExitingEditMode, EnteredPlayMode, ExitingPlayMode }

    public enum ImportAssetOptions { Default, ForceUpdate }

    public static class Selection
    {
        public static UnityEngine.Object[] objects => Array.Empty<UnityEngine.Object>();
        public static UnityEngine.Object activeObject { get; set; }
    }

    public class AssetImporter
    {
        public static AssetImporter GetAtPath(string path) => new AssetImporter();
        public void SaveAndReimport() { }
    }

    public static class AssetDatabase
    {
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
    public static class CompilationPipeline
    {
        public static event Action<object> compilationFinished;
        public static void RaiseFinished(object result) => compilationFinished?.Invoke(result);
    }
}
