#!/usr/bin/env node
// OpenSpec 状态检查（审计 P1.3）：变更必须归档，不得长期滞留开放 change。
//
// 背景：`openspec validate <change>` 只校验单个 change 的结构，不关心它是否被归档；
// 一个"全部任务已勾选但从未归档"的变更会同时通过校验与官方命令，从而掩盖"当前基线是什么"的问题。
import { readdir, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import process from 'node:process'

const ROOT = resolve(process.argv[2] ?? process.cwd())
const CHANGES = join(ROOT, 'openspec', 'changes')
const ARCHIVE = join(CHANGES, 'archive')

/** 允许长期开放的变更（在研中）：需在此显式登记并注明原因。 */
const ALLOWED_ACTIVE = new Set()

async function listDirs(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  } catch {
    return []
  }
}

export async function checkOpenSpecState(failures) {
  const changes = await listDirs(CHANGES)
  if (changes.length === 0 && (await stat(CHANGES).catch(() => null)) === null) {
    failures.push('缺少 openspec/changes 目录')
    return { active: 0, archived: 0 }
  }
  const active = changes.filter((name) => name !== 'archive' && !ALLOWED_ACTIVE.has(name))
  for (const name of active) {
    failures.push(`OpenSpec 变更 ${name} 仍处于开放状态：请归档（openspec archive ${name}）或在 check-openspec-state.mjs 的 ALLOWED_ACTIVE 中登记原因`)
  }
  const archived = await listDirs(ARCHIVE)
  if (archived.length === 0) {
    failures.push('openspec/changes/archive 为空：至少应存在一个已归档变更')
  }
  return { active: active.length, archived: archived.length }
}

if (process.argv[1] && process.argv[1].endsWith('check-openspec-state.mjs')) {
  const failures = []
  const { active, archived } = await checkOpenSpecState(failures)
  if (failures.length > 0) {
    console.error(`OpenSpec 状态检查失败（${failures.length} 项）：`)
    for (const failure of failures) console.error(`  - ${failure}`)
    process.exit(1)
  }
  console.log(`OpenSpec 状态检查通过（开放变更 ${active} 个，已归档 ${archived} 个）`)
}
