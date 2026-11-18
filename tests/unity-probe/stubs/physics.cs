// 物理域离线 stub（v27 能力补齐）。
//
// 只服务 tests/unity-probe 的离线编译与语义用例：
//   - compile-check 与 capability-semantics 会把本文件与主 stub 一起编译；
//   - 主 stub（unity-stubs.cs / semantics-stubs.cs）已经定义 Physics / Collider / Vector2 等，
//     这里**绝不能**重复定义（否则 CS0101），只补主 stub 没有的物理类型；
//   - 包类型（URP/InputSystem 等）不在这里；物理全部是内置模块，正常可以直接引用。
//
// 为什么需要可执行的替身：
//   - semantic harness 会真实调用探针，探针用泛型 AddComponent<T> 添加关节；主 stub 的
//     GameObject 只有 AddComponent(Type)，因此这里用扩展方法补上泛型重载（真实 Unity 自带
//     实例方法，实例方法优先，扩展永远不会生效；本文件也不随探针发布）；
//   - 句柄夹具（DshPhysicsTestTypes.Fixtures）让语义用例能通过 unity.reflect.invoke 拿到
//     真实存在对象的 handle，从而覆盖 get/set 主路径，而不是只测错误路径。
using System;

namespace UnityEngine
{
    // ===== 关节 =====
    // Joint 真实继承 Component（没有 enabled）；探针用反射读取 enabled，本 stub 提供该属性
    // 只为让语义用例能断言「enabled=true」这一返回字段。
    public class Joint : Component
    {
        public Rigidbody connectedBody { get; set; }
        public bool enableCollision { get; set; }
        public bool enablePreprocessing { get; set; } = true;
        public Vector3 anchor { get; set; }
        public Vector3 axis { get; set; } = new Vector3(1f, 0f, 0f);
        public float breakForce { get; set; } = float.PositiveInfinity;
        public float breakTorque { get; set; } = float.PositiveInfinity;
        public bool enabled { get; set; } = true;
    }

    public class HingeJoint : Joint { }
    public class FixedJoint : Joint { }
    public class SpringJoint : Joint { }
    public class CharacterJoint : Joint { }
    public class ConfigurableJoint : Joint { }

    // ===== 刚体 =====
    public enum ForceMode { Force, Acceleration, Impulse, VelocityChange }

    [Flags]
    public enum RigidbodyConstraints
    {
        None = 0,
        FreezePositionX = 2,
        FreezePositionY = 4,
        FreezePositionZ = 8,
        FreezeRotationX = 16,
        FreezeRotationY = 32,
        FreezeRotationZ = 64,
        FreezePosition = 14,
        FreezeRotation = 112,
        FreezeAll = 126,
    }

    public class Rigidbody : Component
    {
        public float mass { get; set; } = 1f;
        // v27：Unity 6 把 drag/angularDrag/velocity 更名为 linearDamping/angularDamping/linearVelocity，
        // 探针走反射兼容两套名字；stub 保留 2022.3 的旧名字作为主路径替身。
        public float drag { get; set; }
        public float angularDrag { get; set; } = 0.05f;
        public bool useGravity { get; set; } = true;
        public bool isKinematic { get; set; }
        public RigidbodyConstraints constraints { get; set; }
        public Vector3 velocity { get; set; }
        public Vector3 angularVelocity { get; set; }
        public Vector3 position { get; set; }
        public void AddForce(Vector3 force, ForceMode mode) { }
        public void AddTorque(Vector3 torque, ForceMode mode) { }
        public void AddExplosionForce(float explosionForce, Vector3 explosionPosition, float explosionRadius, float upwardsModifier) { }
    }

    // ===== 2D 刚体 =====
    public enum RigidbodyType2D { Dynamic = 0, Kinematic = 1, Static = 2 }

    [Flags]
    public enum RigidbodyConstraints2D
    {
        None = 0,
        FreezePositionX = 1,
        FreezePositionY = 2,
        FreezeRotation = 4,
        FreezePosition = 3,
        FreezeAll = 7,
    }

    public class Rigidbody2D : Component
    {
        public float mass { get; set; } = 1f;
        public float drag { get; set; }
        public float angularDrag { get; set; } = 0.05f;
        public float gravityScale { get; set; } = 1f;
        public bool isKinematic { get; set; }
        public bool fixedAngle { get; set; }
        public RigidbodyConstraints2D constraints { get; set; }
        public Vector2 velocity { get; set; }
        public float angularVelocity { get; set; }
        public RigidbodyType2D bodyType { get; set; } = RigidbodyType2D.Dynamic;
        public bool simulated { get; set; } = true;
        public Vector2 position { get; set; }
    }

    public class Collider2D : Component
    {
        public bool enabled { get; set; } = true;
    }

    // ===== 2D 查询 =====
    public struct RaycastHit2D
    {
        public Vector2 point;
        public Vector2 normal;
        public float distance;
        public Collider2D collider;

        public static implicit operator bool(RaycastHit2D hit) { return hit.collider != null; }
    }

    public enum SimulationMode2D { FixedUpdate, Update, Script }

    public static class Physics2D
    {
        public static Vector2 gravity { get; set; } = new Vector2(0f, -9.81f);
        public static int velocityIterations { get; set; } = 8;
        public static int positionIterations { get; set; } = 3;
        public static bool queriesHitTriggers { get; set; } = true;
        public static bool queriesStartInColliders { get; set; } = false;
        public static SimulationMode2D simulationMode { get; set; } = SimulationMode2D.FixedUpdate;

        public const int AllLayers = -1;
        public const int DefaultRaycastLayers = -5;

        public static RaycastHit2D Raycast(Vector2 origin, Vector2 direction, float distance, int layerMask)
        {
            return new RaycastHit2D();
        }

        public static RaycastHit2D[] RaycastAll(Vector2 origin, Vector2 direction, float distance, int layerMask)
        {
            return new RaycastHit2D[0];
        }

        public static RaycastHit2D CircleCast(Vector2 origin, float radius, Vector2 direction, float distance, int layerMask)
        {
            return new RaycastHit2D();
        }

        public static RaycastHit2D[] CircleCastAll(Vector2 origin, float radius, Vector2 direction, float distance, int layerMask)
        {
            return new RaycastHit2D[0];
        }

        public static RaycastHit2D BoxCast(Vector2 origin, Vector2 size, float angle, Vector2 direction, float distance, int layerMask)
        {
            return new RaycastHit2D();
        }

        public static RaycastHit2D[] BoxCastAll(Vector2 origin, Vector2 size, float angle, Vector2 direction, float distance, int layerMask)
        {
            return new RaycastHit2D[0];
        }

        public static Collider2D OverlapCircle(Vector2 point, float radius, int layerMask)
        {
            return null;
        }

        public static Collider2D[] OverlapCircleAll(Vector2 point, float radius, int layerMask)
        {
            return new Collider2D[0];
        }
    }

    // ===== 物理材质 =====
    // 2022.3 名称是 PhysicMaterial；Unity 6 改名为 PhysicsMaterial（旧的直接引用会编译错误），
    // 探针只用反射按名字解析，本 stub 提供 2022.3 名称供离线运行。
    public enum PhysicMaterialCombine { Average, Multiply, Minimum, Maximum }

    public class PhysicMaterial : Object
    {
        public float dynamicFriction { get; set; } = 0.6f;
        public float staticFriction { get; set; } = 0.6f;
        public float bounciness { get; set; }
        public PhysicMaterialCombine frictionCombine { get; set; } = PhysicMaterialCombine.Average;
        public PhysicMaterialCombine bounceCombine { get; set; } = PhysicMaterialCombine.Average;
    }

    // 只给语义夹具用的碰撞体：Collider.sharedMaterial 是真实基类属性，主 stub 没覆盖，
    // 探针按运行时类型反射写入，所以这里在派生类型上提供该属性。
    public class MeshCollider : Collider
    {
        public PhysicMaterial sharedMaterial { get; set; }
    }
}

namespace DSHBridge
{
    /// <summary>
    /// 离线 stub 专用：补 GameObject.AddComponent&lt;T&gt;。
    /// 真实 Unity 的 GameObject 自带同名泛型实例方法，实例方法优先，扩展不会生效；
    /// 本类型只在测试 stub 目录里存在，不会随探针发布。
    /// </summary>
    public static class DshPhysicsStubGameObjectExtensions
    {
        public static T AddComponent<T>(this UnityEngine.GameObject gameObject) where T : UnityEngine.Component
        {
            var component = (UnityEngine.Component)Activator.CreateInstance(typeof(T));
            component.gameObject = gameObject;
            if (gameObject.transform != null) component.transform = gameObject.transform;
            return (T)component;
        }
    }
}

namespace DshPhysicsTestTypes
{
    /// <summary>
    /// 语义用例句柄夹具：Capability harness 通过 unity.reflect.invoke 读取这些静态字段，
    /// 拿到 stub 中真实存在的 Unity 对象句柄（handles），再喂给目标型能力，覆盖 get/set 主路径。
    /// 只是测试替身，不属于探针 API 面。
    /// </summary>
    public static class Fixtures
    {
        public static readonly UnityEngine.GameObject TargetObject = new UnityEngine.GameObject("PhysicsTarget");

        public static readonly UnityEngine.Rigidbody Rigidbody3D = new UnityEngine.Rigidbody
        {
            name = "PhysicsBody",
            mass = 1.5f,
            drag = 0.1f,
            angularDrag = 0.05f,
            useGravity = true,
            isKinematic = false,
            constraints = UnityEngine.RigidbodyConstraints.None,
            velocity = new UnityEngine.Vector3(0f, 0f, 0f),
        };

        public static readonly UnityEngine.Rigidbody2D Rigidbody2DFixture = new UnityEngine.Rigidbody2D
        {
            name = "PhysicsBody2D",
            mass = 2f,
            drag = 0f,
            angularDrag = 0.05f,
            gravityScale = 1f,
            isKinematic = false,
            fixedAngle = false,
            constraints = UnityEngine.RigidbodyConstraints2D.None,
            velocity = new UnityEngine.Vector2(0f, 0f),
            bodyType = UnityEngine.RigidbodyType2D.Dynamic,
        };

        public static readonly UnityEngine.MeshCollider ColliderFixture = new UnityEngine.MeshCollider
        {
            name = "PhysicsCollider",
        };

        public static readonly UnityEngine.PhysicMaterial PhysicMaterialFixture = new UnityEngine.PhysicMaterial
        {
            name = "PhysicsMaterialFixture",
            dynamicFriction = 0.6f,
            staticFriction = 0.6f,
            bounciness = 0.25f,
        };
    }
}
