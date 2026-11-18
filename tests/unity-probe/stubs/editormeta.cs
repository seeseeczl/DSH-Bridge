// 域级 stub：编辑器元数据域（tests/unity-probe/stubs/editormeta.cs）。
//
// 职责（只服务离线编译与语义测试；真机使用的是 Unity 自带类型）：
//   1. 补 InternalEditorUtility / Tools / Tool / SerializedObject / SerializedProperty 的最小面；
//   2. 用 DSHBridgeEditorMetaSandbox 承载「受控 TagManager」：tags / layers 两个静态列表，
//      并支持模拟读取失败（语义用例的错误路径）；
//   3. 探针把这些 API 抽成域内私有方法，真机走 ProjectSettings/TagManager.asset，
//      离线时 TagManager 资产取不到（共享 stub 的 AssetDatabase.LoadAllAssetsAtPath 恒为空），
//      由本文件的 SerializedObject 替身接管：它忽略 target、直接读写 DSHBridgeEditorMetaSandbox。
//      —— 这就是「TagManager 序列化层的受控替身」，探针侧不需要任何测试开关。
//
// 约定：不得重复定义 unity-stubs.cs / semantics-stubs.cs 已定义的类型（会 CS0101）。
using System;
using System.Collections.Generic;

/// <summary>
/// 受控 TagManager 状态。真实工程里由 ProjectSettings/TagManager.asset 承载；
/// 离线语义测试里由这三个静态成员承载，语义用例可直接 Reset / 断言。
/// </summary>
public static class DSHBridgeEditorMetaSandbox
{
    /// <summary>当前 tag 列表（顺序与真实 Unity 一致：7 个内置 tag 在前）。</summary>
    public static readonly List<string> Tags = new List<string>();

    /// <summary>32 项层名（0-7 内置层，8-31 自定义层；空串表示空槽）。</summary>
    public static readonly List<string> Layers = new List<string>();

    /// <summary>置 true 时模拟 TagManager 资产/序列化视图不可用（错误路径用例）。</summary>
    public static bool AssetUnavailable;

    /// <summary>置 true 时模拟 InternalEditorUtility.tags 读取失败（tag.list 的回退路径用例）。</summary>
    public static bool TagsUnavailable;

    public static void Reset()
    {
        Tags.Clear();
        Tags.Add("Untagged");
        Tags.Add("Respawn");
        Tags.Add("Finish");
        Tags.Add("EditorOnly");
        Tags.Add("MainCamera");
        Tags.Add("Player");
        Tags.Add("GameController");

        Layers.Clear();
        Layers.Add("Default");
        Layers.Add("TransparentFX");
        Layers.Add("Ignore Raycast");
        Layers.Add("");
        Layers.Add("Water");
        Layers.Add("UI");
        Layers.Add("");
        Layers.Add("");
        for (var i = 8; i < 32; i++) Layers.Add("");

        AssetUnavailable = false;
        TagsUnavailable = false;
        UnityEditor.Tools.current = UnityEditor.Tool.Move;
    }
}

namespace UnityEditorInternal
{
    /// <summary>
    /// InternalEditorUtility 最小面：只暴露探针读取 tag 列表用的 tags。
    /// 读取失败由 DSHBridgeEditorMetaSandbox.TagsUnavailable 控制，用于覆盖 tag.list 的回退路径。
    /// </summary>
    public static class InternalEditorUtility
    {
        public static string[] tags
        {
            get
            {
                if (DSHBridgeEditorMetaSandbox.TagsUnavailable)
                    throw new InvalidOperationException("stub: InternalEditorUtility.tags unavailable");
                return DSHBridgeEditorMetaSandbox.Tags.ToArray();
            }
        }
    }
}

namespace UnityEditor
{
    /// <summary>UnityEditor.Tool 的最小替身（数值与 Unity 一致；None = -1）。</summary>
    public enum Tool { None = -1, View = 0, Move = 1, Rotate = 2, Scale = 3, Rect = 4, Transform = 5, Custom = 6 }

    /// <summary>工具状态替身：语义用例通过 DSHBridgeEditorMetaSandbox.Reset() 复位到 Move。</summary>
    public static class Tools
    {
        public static Tool current { get; set; } = Tool.Move;
    }

    /// <summary>
    /// SerializedObject 受控替身：忽略 targetObject（离线时真机资产不可得，探针会传 null），
    /// 只认识 TagManager 的 tags / layers 两个数组属性，读写都落到 DSHBridgeEditorMetaSandbox。
    /// AssetUnavailable 时构造抛异常，模拟「TagManager.asset 缺失」，探针会映射为 not_found。
    /// </summary>
    public class SerializedObject
    {
        public SerializedObject(UnityEngine.Object target)
        {
            if (DSHBridgeEditorMetaSandbox.AssetUnavailable)
                throw new InvalidOperationException("stub: ProjectSettings/TagManager.asset unavailable");
            targetObject = target;
        }

        public UnityEngine.Object targetObject { get; private set; }

        public SerializedProperty FindProperty(string propertyPath)
        {
            if (propertyPath == "tags") return SerializedProperty.Root(DSHBridgeEditorMetaSandbox.Tags);
            if (propertyPath == "layers") return SerializedProperty.Root(DSHBridgeEditorMetaSandbox.Layers);
            return null;
        }

        public bool ApplyModifiedProperties() { return true; }

        public void Update() { }

        public void Dispose() { }
    }

    /// <summary>
    /// SerializedProperty 受控替身：只实现探针用到的字符串数组读写面。
    /// 根属性（index = -1）只提供 arraySize；元素属性提供 stringValue。
    /// </summary>
    public class SerializedProperty
    {
        readonly List<string> _items;
        readonly int _index;

        SerializedProperty(List<string> items, int index)
        {
            _items = items;
            _index = index;
        }

        internal static SerializedProperty Root(List<string> items) { return new SerializedProperty(items, -1); }

        public int arraySize
        {
            get { return _items.Count; }
            set
            {
                while (_items.Count < value) _items.Add("");
                if (_items.Count > value) _items.RemoveRange(value, _items.Count - value);
            }
        }

        public SerializedProperty GetArrayElementAtIndex(int index) { return new SerializedProperty(_items, index); }

        public void InsertArrayElementAtIndex(int index)
        {
            if (index < 0) index = 0;
            if (index > _items.Count) index = _items.Count;
            _items.Insert(index, "");
        }

        public void DeleteArrayElementAtIndex(int index)
        {
            if (index >= 0 && index < _items.Count) _items.RemoveAt(index);
        }

        public string stringValue
        {
            get { return _index >= 0 && _index < _items.Count ? _items[_index] : ""; }
            set { if (_index >= 0 && _index < _items.Count) _items[_index] = value; }
        }
    }
}
