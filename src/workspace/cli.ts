import yargs from "yargs"
import type { Argv } from "yargs"
import { initWorkspace, loadWorkspaceConfig, listWorkspaceIds } from "./store"
import { refreshWorkspace } from "./runtime"
import { verboseLog } from "../Verbose"

let normalizeMultiValue = (value: unknown) => {
  if (value == null) return []
  let raw = Array.isArray(value) ? value : [value]
  return raw
    .flatMap(x => String(x).split(","))
    .map(x => x.trim())
    .filter(Boolean)
}

export let configureWorkspaceCli = (cli: Argv) =>
  cli
    .usage("Usage: $0 <command> [options]")
    .command(
      "init <id>",
      "Create a server-managed workspace under .msgmon/workspaces/<id>",
      y =>
        y
          .positional("id", {
            type: "string",
            demandOption: true,
            describe: "Workspace identifier",
          })
          .option("name", {
            type: "string",
            describe: "Workspace display name (defaults to id)",
          })
          .option("account", {
            type: "array",
            string: true,
            default: ["default"],
            coerce: normalizeMultiValue,
            describe: "Account(s) to ingest from (repeatable, comma-separated)",
          })
          .option("query", {
            type: "string",
            default: "is:unread",
            describe: "Default ingest query",
          }),
      async argv => {
        let result = initWorkspace(argv.id!, {
          name: argv.name,
          accounts: argv.account,
          query: argv.query,
        })

        console.log(JSON.stringify({
          created: true,
          workspaceId: result.config.id,
          path: result.path,
          config: result.config,
        }, null, 2))
      },
    )
    .command(
      "refresh <id>",
      "Ingest new messages into the server-owned workspace inbox",
      y =>
        y
          .positional("id", {
            type: "string",
            demandOption: true,
            describe: "Workspace identifier",
          })
          .option("max-results", {
            type: "number",
            default: 100,
            describe: "Maximum messages per account per refresh",
          })
          .option("mark-read", {
            type: "boolean",
            default: false,
            describe: "Mark messages as read after successful ingest",
          })
          .option("save-attachments", {
            type: "boolean",
            default: false,
            describe: "Download and save attachments",
          })
          .option("seed", {
            type: "boolean",
            default: false,
            describe: "Record IDs in state without writing inbox files",
          })
          .option("verbose", {
            alias: "v",
            type: "boolean",
            default: false,
            describe: "Print diagnostic details to stderr",
          }),
      async argv => {
        verboseLog(argv.verbose, "workspace refresh", {
          workspaceId: argv.id,
          maxResults: argv.maxResults,
          markRead: argv.markRead,
          saveAttachments: argv.saveAttachments,
          seed: argv.seed,
        })

        let result = await refreshWorkspace({
          workspaceId: argv.id!,
          maxResults: argv.maxResults,
          markRead: argv.markRead,
          saveAttachments: argv.saveAttachments,
          seed: argv.seed,
          verbose: argv.verbose,
        })

        console.log(JSON.stringify({
          workspaceId: argv.id,
          ...result,
        }, null, 2))
      },
    )
    .command(
      "show <id>",
      "Show workspace configuration",
      y =>
        y.positional("id", {
          type: "string",
          demandOption: true,
          describe: "Workspace identifier",
        }),
      async argv => {
        let config = loadWorkspaceConfig(argv.id!)
        console.log(JSON.stringify(config, null, 2))
      },
    )
    .command(
      "list",
      "List workspace ids",
      () => {},
      async () => {
        console.log(JSON.stringify({ workspaces: listWorkspaceIds() }, null, 2))
      },
    )
    .demandCommand(1, "Choose a command: init, refresh, show, or list.")
    .strict()
    .help()

export let parseWorkspaceCli = (args: string[], scriptName = "msgmon workspace") =>
  configureWorkspaceCli(yargs(args).scriptName(scriptName)).parseAsync()
