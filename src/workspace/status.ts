import fs from "node:fs"
import path from "node:path"
import { loadWorkspaceConfig } from "./init"
import { listNotes } from "../note/store"
import { listBriefingItems } from "../briefing/store"
import { listDrafts } from "../draft/store"

export let workspaceStatus = (dir: string) => {
  let config = loadWorkspaceConfig(dir)

  // Count messages
  let messagesDir = path.resolve(dir, "messages")
  let messageCount = 0
  if (fs.existsSync(messagesDir)) {
    messageCount = fs.readdirSync(messagesDir).filter(f => {
      let full = path.resolve(messagesDir, f)
      return fs.statSync(full).isDirectory()
    }).length
  }

  // Count corpus files
  let corpusDir = path.resolve(dir, "corpus")
  let hasCorpus = fs.existsSync(path.resolve(corpusDir, "messages.jsonl"))

  // Notes summary
  let notes = listNotes(dir)
  let notesByStatus = { pending: 0, done: 0, moot: 0 }
  for (let n of notes) notesByStatus[n.status] = (notesByStatus[n.status] ?? 0) + 1

  // Briefing items
  let briefingItems = listBriefingItems(dir)
  let briefingByStatus = { pending: 0, reviewed: 0, acted: 0 }
  for (let b of briefingItems) briefingByStatus[b.status] = (briefingByStatus[b.status] ?? 0) + 1

  // Drafts
  let drafts = listDrafts()

  // Instructions file
  let instructionsPath = path.resolve(dir, config.instructionsFile)
  let hasInstructions = fs.existsSync(instructionsPath)

  return {
    workspace: config.name,
    accounts: config.accounts.map(a => `${a.platform}:${a.name}`),
    watchIntervalMs: config.watchIntervalMs,
    messages: { total: messageCount },
    corpus: { built: hasCorpus },
    notes: { total: notes.length, ...notesByStatus },
    briefing: { total: briefingItems.length, ...briefingByStatus },
    drafts: { total: drafts.length },
    instructions: { file: config.instructionsFile, exists: hasInstructions },
  }
}
