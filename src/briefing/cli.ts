import yargs from "yargs"
import type { Argv } from "yargs"
import {
  generateBriefingId,
  saveBriefingItem,
  listBriefingItems,
  deleteBriefingItem,
  resolveBriefingItem,
  clearActed,
} from "./store"
import type { BriefingItem, BriefingItemType, BriefingStatus, BriefingAction } from "./schema"

let normalizeMultiValue = (value: unknown) => {
  if (value == null) return []
  let raw = Array.isArray(value) ? value : [value]
  return raw
    .flatMap(x => String(x).split(","))
    .map(x => x.trim())
    .filter(Boolean)
}

let shortId = (id: string) => id.slice(0, 8)

export let configureBriefingCli = (cli: Argv) =>
  cli
    .usage("Usage: $0 <command> [options]")
    .option("dir", {
      type: "string",
      default: ".",
      describe: "Workspace root directory",
    })
    .command(
      "add",
      "Add an item to the briefing queue",
      y =>
        y
          .option("type", {
            type: "string",
            choices: ["new-message", "thread-update", "action-due", "draft-ready", "info"] as const,
            default: "new-message" as const,
            describe: "Item type",
          })
          .option("summary", {
            type: "string",
            demandOption: true,
            describe: "One-line summary",
          })
          .option("detail", {
            type: "string",
            default: "",
            describe: "Full detail / context",
          })
          .option("priority", {
            type: "string",
            choices: ["high", "normal", "low"] as const,
            default: "normal" as const,
            describe: "Priority",
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
          .option("note-id", {
            type: "array",
            string: true,
            default: [] as string[],
            coerce: normalizeMultiValue,
            describe: "Related note ID(s)",
          })
          .option("draft-id", {
            type: "string",
            describe: "Related draft ID",
          }),
      async argv => {
        let now = new Date().toISOString()
        let item: BriefingItem = {
          id: generateBriefingId(),
          createdAt: now,
          updatedAt: now,
          type: argv.type as BriefingItemType,
          status: "pending",
          summary: argv.summary,
          detail: argv.detail,
          messageIds: argv.messageId,
          threadIds: argv.threadId,
          noteIds: argv.noteId,
          draftId: argv.draftId,
          priority: argv.priority as "high" | "normal" | "low",
        }
        let filePath = saveBriefingItem(argv.dir!, item)
        console.log(JSON.stringify({ id: item.id, type: item.type, summary: item.summary, path: filePath }))
      },
    )
    .command(
      "queue",
      "Show pending briefing items (the 'brief me' view)",
      y =>
        y
          .option("format", {
            type: "string",
            choices: ["json", "text"] as const,
            default: "json",
            describe: "Output format",
          })
          .option("all", {
            type: "boolean",
            default: false,
            describe: "Show all items, not just pending",
          }),
      async argv => {
        let items = argv.all
          ? listBriefingItems(argv.dir!)
          : listBriefingItems(argv.dir!, { status: "pending" })
        if (argv.format === "text") {
          if (items.length === 0) {
            console.log("No pending briefing items.")
            return
          }
          for (let i = 0; i < items.length; i++) {
            let item = items[i]
            let pri = item.priority === "high" ? "!" : item.priority === "low" ? "." : " "
            let status = item.status === "acted" ? "x" : item.status === "reviewed" ? "r" : " "
            let draft = item.draftId ? ` [draft:${item.draftId.slice(0, 8)}]` : ""
            console.log(`${i + 1}.${pri}[${status}] ${shortId(item.id)} ${item.type.padEnd(14)} ${item.summary}${draft}`)
            if (item.detail) {
              let lines = item.detail.split("\n").slice(0, 3)
              for (let line of lines) console.log(`     ${line}`)
            }
          }
        } else {
          console.log(JSON.stringify(items, null, 2))
        }
      },
    )
    .command(
      "show <id>",
      "Show full detail for a briefing item",
      y => y.positional("id", { type: "string", demandOption: true, describe: "Item ID or prefix" }),
      async argv => {
        let item = resolveBriefingItem(argv.dir!, argv.id!)
        console.log(JSON.stringify(item, null, 2))
      },
    )
    .command(
      "review <id>",
      "Record a review action on a briefing item",
      y =>
        y
          .positional("id", { type: "string", demandOption: true, describe: "Item ID or prefix" })
          .option("action", {
            type: "string",
            choices: ["send", "edit", "drop", "wait", "defer"] as const,
            demandOption: true,
            describe: "Action to take",
          })
          .option("note", {
            type: "string",
            describe: "Reviewer's note or instruction",
          }),
      async argv => {
        let item = resolveBriefingItem(argv.dir!, argv.id!)
        item.status = "reviewed"
        item.action = argv.action as BriefingAction
        if (argv.note) item.reviewNote = argv.note
        item.updatedAt = new Date().toISOString()
        saveBriefingItem(argv.dir!, item)
        console.log(JSON.stringify(item, null, 2))
      },
    )
    .command(
      "act <id>",
      "Mark a reviewed item as acted upon",
      y =>
        y
          .positional("id", { type: "string", demandOption: true, describe: "Item ID or prefix" })
          .option("note", { type: "string", describe: "Result note" }),
      async argv => {
        let item = resolveBriefingItem(argv.dir!, argv.id!)
        if (item.status !== "reviewed") {
          throw new Error(`Item ${shortId(item.id)} has not been reviewed yet (status: ${item.status})`)
        }
        item.status = "acted"
        if (argv.note) item.reviewNote = (item.reviewNote ? item.reviewNote + "\n" : "") + argv.note
        item.updatedAt = new Date().toISOString()
        saveBriefingItem(argv.dir!, item)
        console.log(JSON.stringify(item, null, 2))
      },
    )
    .command(
      "clear",
      "Remove all acted-upon briefing items",
      y => y,
      async argv => {
        let count = clearActed(argv.dir!)
        console.log(JSON.stringify({ cleared: count }))
      },
    )
    .command(
      "delete <id>",
      "Delete a briefing item",
      y => y.positional("id", { type: "string", demandOption: true, describe: "Item ID or prefix" }),
      async argv => {
        let item = resolveBriefingItem(argv.dir!, argv.id!)
        deleteBriefingItem(argv.dir!, item.id)
        console.log(JSON.stringify({ deleted: true, id: item.id }))
      },
    )
    .demandCommand(1, "Choose a command: add, queue, show, review, act, clear, delete.")
    .strict()
    .help()

export let parseBriefingCli = (args: string[], scriptName = "msgmon briefing") =>
  configureBriefingCli(yargs(args).scriptName(scriptName)).parseAsync()
