// 文档 / 签名域（v27）离线 stub。
//
// 探针的 unity.reflect.signature 通过 AppDomain 反射读取真实类型，因此这里定义的类型
// 会真的出现在签名输出里，用例可以断言「格式化后的 C# 签名 / 重载 / 可见性 / 继承」。
//
// 约定（见 tests/unity-probe/stubs/README.md）：
//   - 不得重复定义主 stub（unity-stubs.cs / semantics-stubs.cs）已有的类型；
//     本文件只新增 DshTestTypes 下的签名专用类型与 DshDocsCollide 命名空间。
//   - 不引入任何 Unity API；签名域只依赖 System.Reflection。
using System;
using System.Collections.Generic;

namespace DshTestTypes
{
    /// <summary>签名域测试基类：验证 includeInherited 时是否能看到继承成员。</summary>
    public class DocsSignatureBase
    {
        public string InheritedProp { get; set; }
        public void BaseMethod() { }
        public virtual void VirtualMethod() { }
    }

    /// <summary>
    /// 签名域主测试类型：覆盖字段/属性/事件/构造器/重载/泛型/可选参数/params/私有成员。
    /// 成员刻意保持简单，用例只断言格式化结果，不执行它们。
    /// </summary>
    public class DocsSignatureSubject : DocsSignatureBase
    {
        public int PublicField;
        public static string StaticField = "static-value";
        private int _hidden;
        private static readonly string _hiddenStatic = "hidden";
        public string Name { get; private set; }
        public static int Count { get; set; }
        public event Action Changed;

        public DocsSignatureSubject()
        {
        }

        public DocsSignatureSubject(int seed)
        {
            Name = "seed:" + seed;
        }

        public static string EchoStatic(string value)
        {
            return value;
        }

        public int Echo(int value)
        {
            return value;
        }

        public int Echo(int left, int right)
        {
            return left + right;
        }

        public string Echo(string value)
        {
            return value;
        }

        public void Overload(int value)
        {
        }

        public void Overload(string value)
        {
        }

        private void HiddenMethod()
        {
        }

        internal void InternalMethod()
        {
        }

        public T Generic<T>(T value)
        {
            return value;
        }

        public List<int> Numbers(int first, string label = "x", params int[] rest)
        {
            return new List<int> { first };
        }

        public override void VirtualMethod()
        {
        }
    }

    /// <summary>接口类型：断言 type.kind == "interface" 且方法签名可用。</summary>
    public interface DocsSignatureContract
    {
        void ContractMethod();
    }

    /// <summary>枚举类型：断言 type.kind == "enum"。</summary>
    public enum DocsSignatureMode
    {
        Alpha,
        Beta,
    }

    /// <summary>值类型：断言 type.kind == "struct"。</summary>
    public struct DocsSignatureStruct
    {
        public float Value;
    }
}

// 短名冲突用：两个不同命名空间下的同名类型，验证 unity.reflect.signature
// 在短名多命中时返回 candidates 而不是瞎猜一个。
namespace DshDocsCollide.A
{
    public class DocsAmbiguousSubject
    {
        public int FromA;
    }
}

namespace DshDocsCollide.B
{
    public class DocsAmbiguousSubject
    {
        public int FromB;
    }
}
