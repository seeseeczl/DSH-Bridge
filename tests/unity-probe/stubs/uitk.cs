// UI Toolkit 域的离线 stub（与 unity-stubs.cs / semantics-stubs.cs 一起编译）。
//
// 只补探针直接引用到的类型，避免与主 stub 重复定义（CS0101）：
//   - UIDocument / VisualTreeAsset / StyleSheet 在探针里是**直接引用**（2022.3 内置模块）；
//   - PanelSettings 在探针里走反射，但离线语义测试需要类型本体让 FindType 命中，
//     并让 create + changes 的主路径可断言；
//   - UnityEngine.Vector2Int 是 PanelSettings.referenceResolution 的类型。
//
// 真机 UIDocument 继承 MonoBehaviour；离线 stub 只需 Behaviour（已提供 enabled）即可满足探针编译面。
using System;

namespace UnityEngine
{
    /// <summary>UI Toolkit PanelSettings.referenceResolution 的元素类型（真机为 UnityEngine.Vector2Int）。</summary>
    public struct Vector2Int
    {
        public int x;
        public int y;
        public Vector2Int(int x, int y) { this.x = x; this.y = y; }
    }
}

namespace UnityEngine.UIElements
{
    public enum PanelScaleMode
    {
        ConstantPixelSize,
        ScaleWithScreenSize,
        ConstantPhysicalSize,
    }

    public enum PanelScreenMatchMode
    {
        MatchWidthOrHeight,
        Shrink,
        Expand,
    }

    /// <summary>主题样式表资产；探针只按“UnityEngine.Object 子类”做反射加载。</summary>
    public class ThemeStyleSheet : UnityEngine.ScriptableObject { }

    /// <summary>UXML 资产；探针 validate 直接 LoadAssetAtPath&lt;VisualTreeAsset&gt;。</summary>
    public class VisualTreeAsset : UnityEngine.ScriptableObject { }

    /// <summary>USS 资产；探针 validate 直接 LoadAssetAtPath&lt;StyleSheet&gt;。</summary>
    public class StyleSheet : UnityEngine.ScriptableObject { }

    /// <summary>
    /// 探针只经反射读写 PanelSettings。这里给出 2022.3 的常用成员面：
    /// 离线下 create/changes 可以真实走通“枚举 / Vector2Int / 浮点 / 资产引用”各分支。
    /// </summary>
    public class PanelSettings : UnityEngine.ScriptableObject
    {
        public ThemeStyleSheet themeStyleSheet { get; set; }
        public UnityEngine.Vector2Int referenceResolution { get; set; }
        public PanelScaleMode scaleMode { get; set; }
        public PanelScreenMatchMode screenMatchMode { get; set; }
        public float match { get; set; }
        public float sortOrder { get; set; }
        public UnityEngine.RenderTexture targetTexture { get; set; }
    }

    /// <summary>
    /// 探针直接引用的 UIDocument（AddComponent / GetComponent / FindObjectsOfType）。
    /// 属性面只用于反射读取与写入，不参与 probe 编译期绑定。
    /// </summary>
    public class UIDocument : UnityEngine.Behaviour
    {
        public PanelSettings panelSettings { get; set; }
        public VisualTreeAsset visualTreeAsset { get; set; }
        public float sortingOrder { get; set; }
        public VisualElement rootVisualElement { get; set; }
    }

    /// <summary>离线视觉树节点；真机类型成员远多于此，探针通过反射遍历。</summary>
    public class VisualElement
    {
        public string name { get; set; }
    }
}
