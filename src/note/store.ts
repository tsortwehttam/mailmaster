import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"
import type { Note, NoteType, NoteStatus } from "./schema"

let notesDir = (workspaceDir: string) => {
  let dir = path.resolve(workspaceDir, "notes")
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

export let generateNoteId = () => crypto.randomUUID()

export let saveNote = (workspaceDir: string, note: Note) => {
  let filePath = path.resolve(notesDir(workspaceDir), `${note.id}.json`)
  fs.writeFileSync(filePath, JSON.stringify(note, null, 2) + "\n")
  return filePath
}

export let loadNote = (workspaceDir: string, id: string): Note => {
  let filePath = path.resolve(notesDir(workspaceDir), `${id}.json`)
  if (!fs.existsSync(filePath)) throw new Error(`Note "${id}" not found`)
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as Note
}

export let listNotes = (
  workspaceDir: string,
  filters?: { type?: NoteType; status?: NoteStatus; tag?: string },
): Note[] => {
  let dir = notesDir(workspaceDir)
  if (!fs.existsSync(dir)) return []
  let files = fs.readdirSync(dir).filter(f => f.endsWith(".json")).sort()
  let notes: Note[] = []
  for (let file of files) {
    try {
      let note = JSON.parse(fs.readFileSync(path.resolve(dir, file), "utf8")) as Note
      if (filters?.type && note.type !== filters.type) continue
      if (filters?.status && note.status !== filters.status) continue
      if (filters?.tag && !note.tags.includes(filters.tag)) continue
      notes.push(note)
    } catch {
      // skip malformed
    }
  }
  return notes.sort((a, b) => {
    // High priority first, then by creation date (newest first)
    let pOrder = { high: 0, normal: 1, low: 2 }
    let pa = pOrder[a.priority] ?? 1
    let pb = pOrder[b.priority] ?? 1
    if (pa !== pb) return pa - pb
    return b.createdAt.localeCompare(a.createdAt)
  })
}

export let deleteNote = (workspaceDir: string, id: string) => {
  let filePath = path.resolve(notesDir(workspaceDir), `${id}.json`)
  if (!fs.existsSync(filePath)) throw new Error(`Note "${id}" not found`)
  fs.unlinkSync(filePath)
}

export let findNotesByMessage = (workspaceDir: string, messageId: string): Note[] => {
  return listNotes(workspaceDir).filter(n => n.messageIds.includes(messageId))
}

export let findNotesByThread = (workspaceDir: string, threadId: string): Note[] => {
  return listNotes(workspaceDir).filter(n => n.threadIds.includes(threadId))
}

export let resolveNote = (workspaceDir: string, idOrPrefix: string): Note => {
  try {
    return loadNote(workspaceDir, idOrPrefix)
  } catch { /* prefix match */ }
  let all = listNotes(workspaceDir)
  let matches = all.filter(n => n.id.startsWith(idOrPrefix))
  if (matches.length === 0) throw new Error(`No note matching "${idOrPrefix}"`)
  if (matches.length > 1) throw new Error(`Ambiguous prefix "${idOrPrefix}" matches ${matches.length} notes`)
  return matches[0]
}
