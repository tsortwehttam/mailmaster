import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"
import type { BriefingItem, BriefingStatus } from "./schema"

let briefingDir = (workspaceDir: string) => {
  let dir = path.resolve(workspaceDir, "briefing")
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

export let generateBriefingId = () => crypto.randomUUID()

export let saveBriefingItem = (workspaceDir: string, item: BriefingItem) => {
  let filePath = path.resolve(briefingDir(workspaceDir), `${item.id}.json`)
  fs.writeFileSync(filePath, JSON.stringify(item, null, 2) + "\n")
  return filePath
}

export let loadBriefingItem = (workspaceDir: string, id: string): BriefingItem => {
  let filePath = path.resolve(briefingDir(workspaceDir), `${id}.json`)
  if (!fs.existsSync(filePath)) throw new Error(`Briefing item "${id}" not found`)
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as BriefingItem
}

export let listBriefingItems = (
  workspaceDir: string,
  filters?: { status?: BriefingStatus; type?: string },
): BriefingItem[] => {
  let dir = briefingDir(workspaceDir)
  if (!fs.existsSync(dir)) return []
  let files = fs.readdirSync(dir).filter(f => f.endsWith(".json")).sort()
  let items: BriefingItem[] = []
  for (let file of files) {
    try {
      let item = JSON.parse(fs.readFileSync(path.resolve(dir, file), "utf8")) as BriefingItem
      if (filters?.status && item.status !== filters.status) continue
      if (filters?.type && item.type !== filters.type) continue
      items.push(item)
    } catch {
      // skip malformed
    }
  }
  return items.sort((a, b) => {
    let pOrder = { high: 0, normal: 1, low: 2 }
    let pa = pOrder[a.priority] ?? 1
    let pb = pOrder[b.priority] ?? 1
    if (pa !== pb) return pa - pb
    return a.createdAt.localeCompare(b.createdAt)
  })
}

export let deleteBriefingItem = (workspaceDir: string, id: string) => {
  let filePath = path.resolve(briefingDir(workspaceDir), `${id}.json`)
  if (!fs.existsSync(filePath)) throw new Error(`Briefing item "${id}" not found`)
  fs.unlinkSync(filePath)
}

export let resolveBriefingItem = (workspaceDir: string, idOrPrefix: string): BriefingItem => {
  try {
    return loadBriefingItem(workspaceDir, idOrPrefix)
  } catch { /* prefix match */ }
  let all = listBriefingItems(workspaceDir)
  let matches = all.filter(b => b.id.startsWith(idOrPrefix))
  if (matches.length === 0) throw new Error(`No briefing item matching "${idOrPrefix}"`)
  if (matches.length > 1) throw new Error(`Ambiguous prefix "${idOrPrefix}" matches ${matches.length} items`)
  return matches[0]
}

export let clearActed = (workspaceDir: string): number => {
  let items = listBriefingItems(workspaceDir, { status: "acted" })
  for (let item of items) deleteBriefingItem(workspaceDir, item.id)
  return items.length
}
