import yargs from "yargs"
import type { Argv } from "yargs"
import { initWorkspace } from "./init"
import { workspaceStatus } from "./status"
import type { AccountConfig } from "./schema"

let parseAccounts = (raw: string[]): AccountConfig[] => {
  return raw.map(entry => {
    // Format: "platform:name" or "platform:name:query"
    let parts = entry.split(":")
    if (parts.length < 2) throw new Error(`Invalid account format "${entry}". Use "platform:name" (e.g. "gmail:work")`)
    let platform = parts[0] as "gmail" | "slack"
    if (platform !== "gmail" && platform !== "slack") {
      throw new Error(`Unsupported platform "${platform}" in "${entry}". Use gmail or slack.`)
    }
    let name = parts[1]
    let query = parts.slice(2).join(":") || "is:unread"
    return { name, platform, query }
  })
}

export let configureWorkspaceCli = (cli: Argv) =>
  cli
    .usage("Usage: $0 <command> [options]")
    .command(
      "init",
      "Initialize a new agent workspace",
      y =>
        y
          .option("dir", {
            type: "string",
            default: ".",
            describe: "Directory to initialize the workspace in",
          })
          .option("name", {
            type: "string",
            demandOption: true,
            describe: "Workspace name (e.g. 'work-inbox', 'personal')",
          })
          .option("account", {
            type: "array",
            string: true,
            demandOption: true,
            describe: "Account(s) in platform:name format (e.g. gmail:work, slack:myteam)",
          })
          .option("watch-interval-ms", {
            type: "number",
            default: 30000,
            describe: "Polling interval for watch mode (ms)",
          })
          .option("mark-read", {
            type: "boolean",
            default: false,
            describe: "Mark messages as read after ingestion",
          }),
      async argv => {
        let accounts = parseAccounts(argv.account)
        let result = initWorkspace({
          dir: argv.dir,
          name: argv.name,
          accounts,
          watchIntervalMs: argv.watchIntervalMs,
          markRead: argv.markRead,
        })
        console.log(JSON.stringify({
          initialized: true,
          workspace: result.config.name,
          root: result.root,
          accounts: result.config.accounts.map(a => `${a.platform}:${a.name}`),
          dirs: ["messages/", "corpus/", "notes/", "briefing/", ".msgmon/drafts/", ".msgmon/state/"],
          instructionsFile: result.config.instructionsFile,
          configPath: result.configPath,
        }, null, 2))
      },
    )
    .command(
      "status",
      "Show workspace status summary",
      y =>
        y
          .option("dir", {
            type: "string",
            default: ".",
            describe: "Workspace root directory",
          })
          .option("format", {
            type: "string",
            choices: ["json", "text"] as const,
            default: "json",
            describe: "Output format",
          }),
      async argv => {
        let status = workspaceStatus(argv.dir)
        if (argv.format === "text") {
          console.log(`Workspace: ${status.workspace}`)
          console.log(`Accounts:  ${status.accounts.join(", ")}`)
          console.log(`Messages:  ${status.messages.total} ingested`)
          console.log(`Corpus:    ${status.corpus.built ? "built" : "not built"}`)
          console.log(`Notes:     ${status.notes.total} (${status.notes.pending} pending, ${status.notes.done} done, ${status.notes.moot} moot)`)
          console.log(`Briefing:  ${status.briefing.total} (${status.briefing.pending} pending, ${status.briefing.reviewed} reviewed, ${status.briefing.acted} acted)`)
          console.log(`Drafts:    ${status.drafts.total}`)
          console.log(`Instructions: ${status.instructions.file} (${status.instructions.exists ? "exists" : "missing"})`)
        } else {
          console.log(JSON.stringify(status, null, 2))
        }
      },
    )
    .command(
      "ingest",
      "Run one-shot ingest using workspace config",
      y =>
        y
          .option("dir", { type: "string", default: ".", describe: "Workspace root" })
          .option("seed", { type: "boolean", default: false, describe: "Seed state without emitting" })
          .option("verbose", { alias: "v", type: "boolean", default: false }),
      async argv => {
        let { loadWorkspaceConfig } = await import("./init")
        let { parseIngestCli } = await import("../ingest/cli")
        let config = loadWorkspaceConfig(argv.dir)
        let accounts = config.accounts.map(a => a.platform === "gmail" ? a.name : `slack:${a.name}`)
        let args = [
          ...accounts.flatMap(a => ["--account", a]),
          "--sink", "dir",
          "--out-dir", `${argv.dir}/messages`,
          "--max-results", String(config.maxResults),
          "--save-attachments",
        ]
        if (config.markRead) args.push("--mark-read")
        if (argv.seed) args.push("--seed")
        if (argv.verbose) args.push("--verbose")
        await parseIngestCli(args, "msgmon workspace ingest")
      },
    )
    .command(
      "watch",
      "Run continuous watch using workspace config",
      y =>
        y
          .option("dir", { type: "string", default: ".", describe: "Workspace root" })
          .option("verbose", { alias: "v", type: "boolean", default: false }),
      async argv => {
        let { loadWorkspaceConfig } = await import("./init")
        let { parseWatchCli } = await import("../ingest/cli")
        let config = loadWorkspaceConfig(argv.dir)
        let accounts = config.accounts.map(a => a.platform === "gmail" ? a.name : `slack:${a.name}`)
        let args = [
          ...accounts.flatMap(a => ["--account", a]),
          "--sink", "dir",
          "--out-dir", `${argv.dir}/messages`,
          "--max-results", String(config.maxResults),
          "--interval-ms", String(config.watchIntervalMs),
          "--save-attachments",
        ]
        if (config.markRead) args.push("--mark-read")
        if (argv.verbose) args.push("--verbose")
        await parseWatchCli(args, "msgmon workspace watch")
      },
    )
    .command(
      "corpus",
      "Build/rebuild corpus from ingested messages",
      y =>
        y
          .option("dir", { type: "string", default: ".", describe: "Workspace root" })
          .option("verbose", { alias: "v", type: "boolean", default: false }),
      async argv => {
        let { parseCorpusCli } = await import("../corpus/cli")
        await parseCorpusCli([
          "--from", `${argv.dir}/messages`,
          "--out-dir", `${argv.dir}/corpus`,
          ...(argv.verbose ? ["--verbose"] : []),
        ], "msgmon workspace corpus")
      },
    )
    .example("$0 init --name=work-inbox --account=gmail:work --account=slack:myteam", "Initialize workspace")
    .example("$0 status --format=text", "Show workspace summary")
    .example("$0 ingest --seed", "Seed workspace with historical messages")
    .example("$0 watch", "Start continuous monitoring")
    .example("$0 corpus", "Build LLM corpus from ingested messages")
    .demandCommand(1, "Choose a command: init, status, ingest, watch, corpus.")
    .strict()
    .help()

export let parseWorkspaceCli = (args: string[], scriptName = "msgmon workspace") =>
  configureWorkspaceCli(yargs(args).scriptName(scriptName)).parseAsync()
