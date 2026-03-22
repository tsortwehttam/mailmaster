import yargs from "yargs"
import type { Argv } from "yargs"
import path from "node:path"
import fs from "node:fs"
import { setWorkspaceDir } from "../CliConfig"
import { runSetup } from "./index"

export let configureSetupCli = (cli: Argv) =>
  cli
    .usage("Usage: $0 [dir] [options]")
    .command("$0 [dir]", false, y =>
      y
        .positional("dir", {
          type: "string",
          describe: "Server workspace directory to initialize (defaults to current directory)",
        })
        .option("workspace", {
          type: "string",
          default: "default",
          hidden: true,
          describe: "Internal server workspace id to create/verify",
        })
        .option("since", {
          type: "string",
          describe: "Lower time bound for the initial pull as ISO timestamp or YYYY-MM-DD",
        })
        .option("until", {
          type: "string",
          describe: "Upper time bound for the initial pull as ISO timestamp or YYYY-MM-DD",
        }))
    .example("$0", "Interactive guided setup in the current directory")
    .example("$0 ./assistant-workspace", "Create the directory if needed and set it up as a server workspace")
    .example("$0 ./assistant-workspace --since=2026-03-15", "Set up a server workspace with an explicit initial lower time bound")
    .epilog(
      [
        "Walks through the full setup process interactively:",
        "  1. Check/create Gmail OAuth credentials",
        "  2. Authorize Gmail account(s) via browser OAuth",
        "  3. Optionally set up Slack",
        "  4. Create a server workspace",
        "  5. Pull the initial message window into messages.jsonl",
        "  6. Print the commands to start the server and agent",
        "",
        "Safe to re-run — skips steps that are already done.",
      ].join("\n"),
    )
    .demandCommand(0)
    .strict()
    .help()

export let parseSetupCli = async (args: string[], scriptName = "msgmon setup") => {
  let argv = await configureSetupCli(yargs(args).scriptName(scriptName)).parseAsync()
  let dir = path.resolve((argv.dir as string | undefined) ?? ".")
  fs.mkdirSync(dir, { recursive: true })
  setWorkspaceDir(dir)
  await runSetup({
    workspace: argv.workspace as string | undefined,
    since: argv.since as string | undefined,
    until: argv.until as string | undefined,
  })
}
