import yargs from "yargs"
import type { Argv } from "yargs"
import { generateNoteId, saveNote, listNotes, deleteNote, resolveNote } from "./store"
import type { Note, NoteType, NoteStatus, NotePriority } from "./schema"

let normalizeMultiValue = (value: unknown) => {
  if (value == null) return []
  let raw = Array.isArray(value) ? value : [value]
  return raw
    .flatMap(x => String(x).split(","))
    .map(x => x.trim())
    .filter(Boolean)
}

let shortId = (id: string) => id.slice(0, 8)

export let configureNoteCli = (cli: Argv) =>
  cli
    .usage("Usage: $0 <command> [options]")
    .option("dir", {
      type: "string",
      default: ".",
      describe: "Workspace root directory",
    })
    .command(
      "add",
      "Create a new note, action item, or decision record",
      y =>
        y
          .option("type", {
            type: "string",
            choices: ["summary", "action", "decision", "info"] as const,
            default: "action" as const,
            describe: "Note type",
          })
          .option("title", {
            type: "string",
            demandOption: true,
            describe: "Short title / headline",
          })
          .option("content", {
            type: "string",
            default: "",
            describe: "Full content / body",
          })
          .option("priority", {
            type: "string",
            choices: ["high", "normal", "low"] as const,
            default: "normal" as const,
            describe: "Priority level",
          })
          .option("status", {
            type: "string",
            choices: ["pending", "done", "moot"] as const,
            default: "pending" as const,
            describe: "Initial status",
          })
          .option("message-id", {
            type: "array",
            string: true,
            default: [] as string[],
            coerce: normalizeMultiValue,
            describe: "Related message ID(s)",
          })
          .option("thread-id", {
            type: "array",
            string: true,
            default: [] as string[],
            coerce: normalizeMultiValue,
            describe: "Related thread ID(s)",
          })
          .option("tag", {
            type: "array",
            string: true,
            default: [] as string[],
            coerce: normalizeMultiValue,
            describe: "Tag(s) for filtering",
          })
          .option("deadline", {
            type: "string",
            describe: "Deadline (ISO-8601 date)",
          })
          .option("draft-id", {
            type: "string",
            describe: "Related draft ID",
          }),
      async argv => {
        let now = new Date().toISOString()
        let note: Note = {
          id: generateNoteId(),
          createdAt: now,
          updatedAt: now,
          type: argv.type as NoteType,
          status: argv.status as NoteStatus,
          priority: argv.priority as NotePriority,
          title: argv.title,
          content: argv.content,
          messageIds: argv.messageId,
          threadIds: argv.threadId,
          tags: argv.tag,
          deadline: argv.deadline,
          draftId: argv.draftId,
        }
        let filePath = saveNote(argv.dir!, note)
        console.log(JSON.stringify({ id: note.id, type: note.type, title: note.title, path: filePath }))
      },
    )
    .command(
      "list",
      "List notes with optional filters",
      y =>
        y
          .option("type", {
            type: "string",
            choices: ["summary", "action", "decision", "info"] as const,
            describe: "Filter by type",
          })
          .option("status", {
            type: "string",
            choices: ["pending", "done", "moot"] as const,
            describe: "Filter by status",
          })
          .option("tag", {
            type: "string",
            describe: "Filter by tag",
          })
          .option("format", {
            type: "string",
            choices: ["json", "text"] as const,
            default: "json",
            describe: "Output format",
          }),
      async argv => {
        let notes = listNotes(argv.dir!, {
          type: argv.type as NoteType | undefined,
          status: argv.status as NoteStatus | undefined,
          tag: argv.tag,
        })
        if (argv.format === "text") {
          if (notes.length === 0) {
            console.log("No notes.")
            return
          }
          for (let n of notes) {
            let pri = n.priority === "high" ? "!" : n.priority === "low" ? "." : " "
            let status = n.status === "done" ? "x" : n.status === "moot" ? "-" : " "
            let tags = n.tags.length ? ` [${n.tags.join(",")}]` : ""
            let deadline = n.deadline ? ` due:${n.deadline}` : ""
            let draft = n.draftId ? ` draft:${n.draftId.slice(0, 8)}` : ""
            console.log(`[${status}]${pri} ${shortId(n.id)} ${n.type.padEnd(8)} ${n.title}${tags}${deadline}${draft}`)
          }
        } else {
          console.log(JSON.stringify(notes, null, 2))
        }
      },
    )
    .command(
      "show <id>",
      "Show a note by ID (prefix match)",
      y => y.positional("id", { type: "string", demandOption: true, describe: "Note ID or prefix" }),
      async argv => {
        let note = resolveNote(argv.dir!, argv.id!)
        console.log(JSON.stringify(note, null, 2))
      },
    )
    .command(
      "update <id>",
      "Update fields on an existing note",
      y =>
        y
          .positional("id", { type: "string", demandOption: true, describe: "Note ID or prefix" })
          .option("title", { type: "string", describe: "New title" })
          .option("content", { type: "string", describe: "New content" })
          .option("status", {
            type: "string",
            choices: ["pending", "done", "moot"] as const,
            describe: "New status",
          })
          .option("priority", {
            type: "string",
            choices: ["high", "normal", "low"] as const,
            describe: "New priority",
          })
          .option("type", {
            type: "string",
            choices: ["summary", "action", "decision", "info"] as const,
            describe: "New type",
          })
          .option("add-message-id", {
            type: "array",
            string: true,
            coerce: normalizeMultiValue,
            describe: "Add related message ID(s)",
          })
          .option("add-thread-id", {
            type: "array",
            string: true,
            coerce: normalizeMultiValue,
            describe: "Add related thread ID(s)",
          })
          .option("add-tag", {
            type: "array",
            string: true,
            coerce: normalizeMultiValue,
            describe: "Add tag(s)",
          })
          .option("remove-tag", {
            type: "array",
            string: true,
            coerce: normalizeMultiValue,
            describe: "Remove tag(s)",
          })
          .option("deadline", { type: "string", describe: "Set deadline (ISO-8601)" })
          .option("draft-id", { type: "string", describe: "Link to a draft ID" }),
      async argv => {
        let note = resolveNote(argv.dir!, argv.id!)
        if (argv.title !== undefined) note.title = argv.title
        if (argv.content !== undefined) note.content = argv.content
        if (argv.status !== undefined) note.status = argv.status as NoteStatus
        if (argv.priority !== undefined) note.priority = argv.priority as NotePriority
        if (argv.type !== undefined) note.type = argv.type as NoteType
        if (argv.addMessageId) note.messageIds = [...new Set([...note.messageIds, ...argv.addMessageId])]
        if (argv.addThreadId) note.threadIds = [...new Set([...note.threadIds, ...argv.addThreadId])]
        if (argv.addTag) note.tags = [...new Set([...note.tags, ...argv.addTag])]
        if (argv.removeTag) note.tags = note.tags.filter(t => !argv.removeTag!.includes(t))
        if (argv.deadline !== undefined) note.deadline = argv.deadline
        if (argv.draftId !== undefined) note.draftId = argv.draftId
        note.updatedAt = new Date().toISOString()
        saveNote(argv.dir!, note)
        console.log(JSON.stringify(note, null, 2))
      },
    )
    .command(
      "delete <id>",
      "Delete a note",
      y => y.positional("id", { type: "string", demandOption: true, describe: "Note ID or prefix" }),
      async argv => {
        let note = resolveNote(argv.dir!, argv.id!)
        deleteNote(argv.dir!, note.id)
        console.log(JSON.stringify({ deleted: true, id: note.id }))
      },
    )
    .command(
      "find",
      "Find notes related to a message or thread",
      y =>
        y
          .option("message-id", { type: "string", describe: "Find notes for this message ID" })
          .option("thread-id", { type: "string", describe: "Find notes for this thread ID" })
          .check(argv => {
            if (!argv.messageId && !argv.threadId) throw new Error("Provide --message-id or --thread-id")
            return true
          }),
      async argv => {
        let { findNotesByMessage, findNotesByThread } = await import("./store")
        let notes: Note[] = []
        if (argv.messageId) notes.push(...findNotesByMessage(argv.dir!, argv.messageId))
        if (argv.threadId) notes.push(...findNotesByThread(argv.dir!, argv.threadId))
        // Dedupe by ID
        let seen = new Set<string>()
        notes = notes.filter(n => {
          if (seen.has(n.id)) return false
          seen.add(n.id)
          return true
        })
        console.log(JSON.stringify(notes, null, 2))
      },
    )
    .demandCommand(1, "Choose a command: add, list, show, update, delete, find.")
    .strict()
    .help()

export let parseNoteCli = (args: string[], scriptName = "msgmon note") =>
  configureNoteCli(yargs(args).scriptName(scriptName)).parseAsync()
