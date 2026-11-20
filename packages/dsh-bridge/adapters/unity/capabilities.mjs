// Unity 适配器声明的能力清单（探针实现的唯一权威表）。
//
// 从 index.mjs 拆出（verify:arch 单文件 400 行硬限）。对外 API 不变：
// index.mjs 原样 re-export 本文件，所有既有 import 路径无需改动。
// 本表同时是能力漂移（capability-drift.test.mjs）与探针源码形状校验的比对基准。

export const UNITY_CAPABILITIES = Object.freeze([
  'unity.editor.status',
  'unity.console.read',
  'unity.hierarchy.list',
  'unity.asset.find',
  'unity.menu.execute',
  'unity.playmode.set',
  'unity.asset.refresh',
  'unity.reflect.invoke',
  // 通用执行面
  'unity.object.find',
  'unity.api.invoke',
  'unity.api.members',
  'unity.search.content',
  'unity.asset.read',
  'unity.asset.create',
  'unity.importer.get',
  'unity.importer.set',
  'unity.scene.list',
  'unity.scene.open',
  'unity.scene.save',
  'unity.selection.set',
  // 语义封装：场景对象 / 组件
  'unity.gameobject.create',
  'unity.gameobject.delete',
  'unity.gameobject.rename',
  'unity.gameobject.duplicate',
  'unity.gameobject.setActive',
  'unity.gameobject.setParent',
  'unity.gameobject.setTransform',
  'unity.component.add',
  'unity.component.remove',
  'unity.component.set',
  'unity.component.get',
  // Prefab
  'unity.prefab.create',
  'unity.prefab.instantiate',
  'unity.prefab.open',
  'unity.prefab.save',
  'unity.prefab.close',
  // 材质与资产
  'unity.material.get',
  'unity.material.set',
  'unity.asset.rename',
  'unity.asset.move',
  'unity.asset.delete',
  'unity.asset.duplicate',
  // 视觉反馈（能力补全第 1 项）：截图落到 Library/DSHBridge/artifacts/，返回路径供 Agent 读图。
  'unity.screenshot.capture',
  // 脚本精细编辑（能力补全第 2 项）：SHA 前置校验 + 行列级 patch。
  'unity.script.get_sha',
  'unity.script.apply_edits',
  // 生产管线与长任务作业（能力补全第 3/6 项）。
  'unity.job.list',
  'unity.job.status',
  'unity.job.cancel',
  'unity.build.start',
  'unity.test.run',
  'unity.package.list',
  'unity.package.add',
  'unity.package.remove',
  'unity.bake.navmesh',
  'unity.bake.lighting',
  // 垂直域第一批：图形 / Profiler / 物理。
  'unity.graphics.quality',
  'unity.graphics.render_settings',
  'unity.graphics.stats',
  'unity.profiler.status',
  'unity.profiler.set',
  'unity.physics.settings',
  'unity.physics.raycast',
  // 垂直域第二批：动画 / 粒子 / UI / ProBuilder / Sprite / 纹理生成。
  'unity.animation.info',
  'unity.animation.set',
  'unity.vfx.particles',
  'unity.vfx.control',
  'unity.ui.canvases',
  'unity.probuilder.state',
  'unity.sprite.info',
  'unity.texture.generate',
  // 原生交互（能力补全第 5 项）。
  'unity.window.list',
  'unity.window.focus',
  'unity.input.send',
  // 补充：截图序列（录屏帧序列）与脚本编译校验。
  'unity.screenshot.sequence',
  'unity.script.validate',
  // 通用反射执行面（可授权）：批量事务与进程内代码执行。
  // unity.code.execute 等价于 MCP 的 execute_code——ASE 的编辑脚本是含控制流的完整程序，
  // 只有整段编译执行才能保持 Undo 组与 AssetDatabase 刷新时序一致。
  'unity.api.batch',
  'unity.code.execute',
  // ===== v27 能力补齐（对标 MCP for Unity / Codely 的深水区）=====
  // 图形：管线检测 / Volume 与后处理 / Renderer Feature / 探针 / 烘焙。
  'unity.graphics.pipeline',
  'unity.graphics.volume.list',
  'unity.graphics.volume.get',
  'unity.graphics.volume.set',
  'unity.graphics.volume.create',
  'unity.graphics.renderer_features',
  'unity.graphics.post_processing',
  'unity.graphics.light_probes',
  'unity.graphics.reflection_probes',
  'unity.bake.light_probes',
  'unity.bake.reflection_probes',
  // 物理：关节 / 碰撞矩阵 / 物理材质 / 刚体 / 力 / 模拟 / 2D。
  'unity.physics.joints',
  'unity.physics.collision_matrix',
  'unity.physics.material',
  'unity.physics.body',
  'unity.physics.forces',
  'unity.physics.simulate',
  'unity.physics.2d.settings',
  'unity.physics.2d.body',
  'unity.physics.2d.raycast',
  // UI Toolkit：UXML / USS / PanelSettings / UIDocument。
  'unity.uitk.uxml',
  'unity.uitk.uss',
  'unity.uitk.panel_settings',
  'unity.uitk.document',
  // Play Mode 输入：鼠标 / 键盘 / 文本 / 虚拟设备 / 序列。
  'unity.input.mouse',
  'unity.input.keyboard',
  'unity.input.type_text',
  'unity.input.device',
  'unity.input.sequence',
  // 编辑器元数据：tag / layer 的 list-ensure-remove + 激活工具。
  'unity.tag.list',
  'unity.tag.ensure',
  'unity.tag.remove',
  'unity.layer.list',
  'unity.layer.ensure',
  'unity.layer.remove',
  'unity.editor.set_active_tool',
  // 文档与签名（防幻觉）：官方 ScriptReference 检索 + 程序集精确签名。
  'unity.reflect.signature',
  'unity.docs.search',
  'unity.docs.get',
])
