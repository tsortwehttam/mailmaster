import yargs from "yargs"
import type { Argv } from "yargs"
import { startSession, stopSessionWatch, syncPull, syncPush, syncWatch, loadSessionState, defaultSessionDir } from "./client"

let withShared = (y: Argv) =>
  y
    .option("server", {
      type: "string",
      describe: "msgmon serve base URL (defaults to local .msgmon/serve.json, then http://127.0.0.1:3271)",
    })
    .option("token", {
      type: "string",
      describe: "X-Auth-Token value (defaults to local .msgmon/serve.json token when present)",
    })
    .option("workspace", {
      type: "string",
      demandOption: true,
      describe: "Server workspace id",
    })
    .option("dir", {
      type: "string",
      describe: "Local agent-safe workspace mirror directory (defaults to ./.msgmon/agent/<workspace>)",
    })

export let configureSyncCli = (cli: Argv) =>
  cli
    .usage("Usage: $0 <command> [options]")
    .command(
      "pull",
      "Pull the latest agent-safe workspace snapshot from serve",
      y => withShared(y).option("force", {
        type: "boolean",
        default: false,
        describe: "Overwrite local writable changes",
      }),
      async argv => {
        let result = await syncPull({
          serverUrl: argv.server,
          token: argv.token,
          workspaceId: argv.workspace,
          dir: argv.dir,
          force: argv.force,
        })
        console.log(JSON.stringify(result, null, 2))
      },
    )
    .command(
      "push",
      "Push local writable workspace changes back to serve",
      y =>
        y.option("dir", {
          type: "string",
          describe: "Local agent-safe workspace mirror directory (defaults to ./.msgmon/agent/<workspace> when --workspace is provided)",
        })
          .option("server", {
            type: "string",
            describe: "Override server URL from local session state",
          })
          .option("token", {
            type: "string",
            describe: "Override token from local session state",
          })
          .option("workspace", {
            type: "string",
            describe: "Override workspace id from local session state",
          }),
      async argv => {
        if (!argv.dir && !argv.workspace) throw new Error("Pass --dir or --workspace so the local session directory can be resolved")
        let result = await syncPush({
          dir: argv.dir,
          serverUrl: argv.server,
          token: argv.token,
          workspaceId: argv.workspace,
        })
        console.log(JSON.stringify(result, null, 2))
      },
    )
    .command(
      "watch",
      "Poll serve and refresh the local mirror when it changes",
      y =>
        withShared(y)
          .option("interval-ms", {
            type: "number",
            default: 5000,
            describe: "Polling interval in milliseconds",
          })
          .option("force", {
            type: "boolean",
            default: false,
            describe: "Overwrite local writable changes while polling",
          })
          .option("auto-push", {
            type: "boolean",
            default: true,
            describe: "Automatically push bounded writable file changes before each pull cycle",
          }),
      async argv => {
        await syncWatch({
          serverUrl: argv.server,
          token: argv.token,
          workspaceId: argv.workspace,
          dir: argv.dir,
          intervalMs: argv.intervalMs,
          force: argv.force,
          autoPush: argv.autoPush,
          onTick: result => {
            console.error(`[msgmon sync] ${result.ok ? "ok" : "skip"}: ${result.message}`)
          },
        })
      },
    )
    .demandCommand(1, "Choose a command: pull, push, or watch.")
    .strict()
    .help()

export let configureSessionCli = (cli: Argv) =>
  cli
    .usage("Usage: $0 <command> [options]")
    .command(
      "start",
      "Bootstrap a local mirror and optionally launch an agent command",
      y =>
        withShared(y)
          .option("watch", {
            type: "boolean",
            default: true,
            describe: "Start a detached sync watcher",
          })
          .option("interval-ms", {
            type: "number",
            default: 5000,
            describe: "Watcher polling interval in milliseconds",
          })
          .option("agent-command", {
            type: "string",
            describe: "Optional shell command to launch in the synced directory, e.g. 'codex .'",
          })
          .option("force", {
            type: "boolean",
            default: false,
            describe: "Overwrite local writable changes during initial pull",
          })
          .option("auto-push", {
            type: "boolean",
            default: true,
            describe: "Automatically push bounded writable file changes from the detached watcher",
          }),
      async argv => {
        let result = await startSession({
          serverUrl: argv.server,
          token: argv.token,
          workspaceId: argv.workspace,
          dir: argv.dir,
          intervalMs: argv.intervalMs,
          watch: argv.watch,
          autoPush: argv.autoPush,
          agentCommand: argv.agentCommand,
          force: argv.force,
        })
        console.log(JSON.stringify(result, null, 2))
      },
    )
    .command(
      "status",
      "Show local session state",
      y =>
        y.option("dir", {
          type: "string",
          describe: "Local agent-safe workspace mirror directory",
        }).option("workspace", {
          type: "string",
          describe: "Workspace id used to derive the default local mirror directory",
        }),
      async argv => {
        let dir = argv.dir ?? (argv.workspace ? defaultSessionDir(argv.workspace) : undefined)
        if (!dir) throw new Error("Pass --dir or --workspace")
        console.log(JSON.stringify(loadSessionState(dir), null, 2))
      },
    )
    .command(
      "stop",
      "Stop the detached sync watcher for a local session",
      y =>
        y.option("dir", {
          type: "string",
          describe: "Local agent-safe workspace mirror directory",
        }).option("workspace", {
          type: "string",
          describe: "Workspace id used to derive the default local mirror directory",
        }),
      async argv => {
        let dir = argv.dir ?? (argv.workspace ? defaultSessionDir(argv.workspace) : undefined)
        if (!dir) throw new Error("Pass --dir or --workspace")
        console.log(JSON.stringify(stopSessionWatch(dir), null, 2))
      },
    )
    .demandCommand(1, "Choose a command: start, status, or stop.")
    .strict()
    .help()

export let parseSyncCli = (args: string[], scriptName = "msgmon sync") =>
  configureSyncCli(yargs(args).scriptName(scriptName)).parseAsync()

export let parseSessionCli = (args: string[], scriptName = "msgmon session") =>
  configureSessionCli(yargs(args).scriptName(scriptName)).parseAsync()
