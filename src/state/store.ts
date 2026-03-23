import fs from "node:fs"
import path from "node:path"
import { workspaceRoot } from "../workspace/store"
import { StateEntry } from "./schema"

let statePath = (workspaceId: string) =>
  path.resolve(workspaceRoot(workspaceId), "state.jsonl")

export let readState = (workspaceId: string): StateEntry[] => {
  let filePath = statePath(workspaceId)
  if (!fs.existsSync(filePath)) return []
  let lines = fs.readFileSync(filePath, "utf8").split("\n").filter(Boolean)
  let entries: StateEntry[] = []
  for (let line of lines) {
    try {
      entries.push(StateEntry.parse(JSON.parse(line)))
    } catch { /* skip malformed */ }
  }
  return entries
}

export let writeState = (workspaceId: string, entries: StateEntry[]) => {
  let filePath = statePath(workspaceId)
  let content = entries.map(e => JSON.stringify(e)).join("\n") + (entries.length ? "\n" : "")
  fs.writeFileSync(filePath, content)
}

export let getEntry = (workspaceId: string, id: string): StateEntry | undefined =>
  readState(workspaceId).find(e => e.id === id)

export let upsertEntry = (workspaceId: string, entry: StateEntry) => {
  let entries = readState(workspaceId)
  let idx = entries.findIndex(e => e.id === entry.id)
  if (idx >= 0) entries[idx] = entry
  else entries.push(entry)
  writeState(workspaceId, entries)
  return entry
}

export let deleteEntry = (workspaceId: string, id: string) => {
  let entries = readState(workspaceId)
  let filtered = entries.filter(e => e.id !== id)
  if (filtered.length === entries.length) throw new Error(`State entry "${id}" not found`)
  writeState(workspaceId, filtered)
}

export let listEntries = (workspaceId: string, type?: string, status?: string): StateEntry[] => {
  let entries = readState(workspaceId)
  if (type) entries = entries.filter(e => e.type === type)
  if (status) entries = entries.filter(e => e.status === status)
  return entries
}
