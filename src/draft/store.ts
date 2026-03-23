import crypto from "node:crypto"
import { getEntry, upsertEntry, deleteEntry, listEntries } from "../state/store"
import { Draft } from "./schema"
import type { StateEntry } from "../state/schema"

export let generateDraftId = () => crypto.randomUUID()

let draftToEntry = (draft: Draft): StateEntry => ({
  id: draft.id,
  type: "draft",
  status: "pending",
  data: draft as unknown as Record<string, unknown>,
  createdAt: draft.createdAt,
  updatedAt: draft.updatedAt,
})

let entryToDraft = (entry: StateEntry): Draft =>
  Draft.parse(entry.data)

export let saveDraft = (workspaceId: string, draft: Draft) => {
  upsertEntry(workspaceId, draftToEntry(draft))
}

export let loadDraft = (workspaceId: string, id: string): Draft => {
  let entry = getEntry(workspaceId, id)
  if (!entry || entry.type !== "draft") throw new Error(`Draft "${id}" not found in workspace "${workspaceId}"`)
  return entryToDraft(entry)
}

export let listDrafts = (workspaceId: string, platform?: string): Draft[] => {
  let entries = listEntries(workspaceId, "draft")
  let drafts = entries.map(e => {
    try { return entryToDraft(e) } catch { return null }
  }).filter((d): d is Draft => d !== null)
  if (platform) drafts = drafts.filter(d => d.platform === platform)
  return drafts.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export let deleteDraft = (workspaceId: string, id: string) => {
  let entry = getEntry(workspaceId, id)
  if (!entry || entry.type !== "draft") throw new Error(`Draft "${id}" not found in workspace "${workspaceId}"`)
  deleteEntry(workspaceId, id)
}
