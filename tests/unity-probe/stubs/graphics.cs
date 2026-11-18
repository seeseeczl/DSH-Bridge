// 图形域离线 stub（v27）。
//
// 只覆盖探针**直接引用**的内置模块类型（LightProbeGroup / ReflectionProbe）；
// 包类型（URP/HDRP 的 Volume、UniversalAdditionalCameraData、ScriptableRendererFeature…）
// 探针一律走反射，本文件不定义它们。
//
// 例外说明：`UnityEngine.Rendering.Volume*` 是**测试替身**——探针通过 Type 反射探测类型名，
// 离线编译时没有 URP 程序集，定义最小同名类型只是为了让 volume.* 的反射代码路径在语义
// 测试里也能被执行到（真机命中 URP 的真实类型）。它不进入任何真实工程。
using System.Collections.Generic;
using UnityEngine;

namespace UnityEngine
{
    /// <summary>内置模块 LightProbeGroup 的最小签名（真机：UnityEngine.CoreModule）。</summary>
    public class LightProbeGroup : Behaviour
    {
        public Vector3[] probePositions { get; set; } = new Vector3[0];
    }

    /// <summary>内置模块 ReflectionProbe 的最小签名；成员名与真机一致，供 SetMember 反射写入。</summary>
    public class ReflectionProbe : Behaviour
    {
        public UnityEngine.Rendering.ReflectionProbeMode mode { get; set; }
        public Vector3 size { get; set; } = new Vector3(1f, 1f, 1f);
        public Vector3 center { get; set; }
        public int resolution { get; set; } = 128;
        public bool hdr { get; set; }
        public float intensity { get; set; } = 1f;
        public bool boxProjection { get; set; }
        public UnityEngine.Rendering.ReflectionProbeClearFlags clearFlags { get; set; }
        public Color backgroundColor { get; set; }
        public int cullingMask { get; set; } = -1;
        public int importance { get; set; }
        public bool RenderProbe() { return true; }
    }
}

namespace UnityEngine.Rendering
{
    /// <summary>ReflectionProbe.mode 的枚举（真机 UnityEngine.Rendering）。</summary>
    public enum ReflectionProbeMode { Baked, Realtime, Custom }

    /// <summary>ReflectionProbe.clearFlags 的枚举（真机 UnityEngine.Rendering）。</summary>
    public enum ReflectionProbeClearFlags { Skybox = 1, SolidColor = 2 }

    // ===== 测试替身：URP Volume 系列（仅离线语义测试可见）=====
    public class Volume : UnityEngine.Behaviour
    {
        public bool isGlobal { get; set; }
        public float priority { get; set; }
        public float weight { get; set; } = 1f;
        public float blendDistance { get; set; }
        public VolumeProfile profile { get; set; }
        public VolumeProfile sharedProfile { get; set; }

        /// <summary>
        /// 测试替身工厂：语义用例通过 unity.reflect.invoke 调它拿到一个带 profile 的 Volume 句柄，
        /// 从而让 volume.get/set 的反射解析路径（profile → components → parameters）也能离线执行。
        /// 真机上不存在该方法。
        /// </summary>
        public static Volume CreateTestVolume()
        {
            var profile = new VolumeProfile { name = "TestProfile" };
            profile.components.Add(new Bloom());
            return new Volume
            {
                name = "Test Volume",
                isGlobal = true,
                priority = 1f,
                weight = 0.8f,
                blendDistance = 2f,
                profile = profile,
                sharedProfile = profile,
            };
        }
    }

    public class VolumeProfile : UnityEngine.ScriptableObject
    {
        public List<VolumeComponent> components { get; set; } = new List<VolumeComponent>();
    }

    public class VolumeComponent : UnityEngine.ScriptableObject
    {
        public bool active { get; set; } = true;
        public List<VolumeParameter> parameters { get; set; } = new List<VolumeParameter>();
    }

    public class VolumeParameter
    {
        public bool overrideState { get; set; }
        public object value { get; set; }
    }

    public class FloatParameter : VolumeParameter
    {
    }

    /// <summary>URP Bloom 组件的最小替身：字段名即参数名（真机同样按字段推导）。</summary>
    public class Bloom : VolumeComponent
    {
        public FloatParameter intensity = new FloatParameter { value = 0.5f };

        public Bloom()
        {
            parameters.Add(intensity);
        }
    }
}
