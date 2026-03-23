import yargs from "yargs"
import type { Argv } from "yargs"
import { startSession, syncPull, syncPush, defaultSessionDir } from "./client"

let withShared = (y: Argv) =>
  y
    .option("server", {
      type: "string",
      describe: "Messaging proxy server base URL (defaults to local .msgmon/serve.json, then http://127.0.0.1:3271)",
    })
    .option("token", {
      type: "string",
      describe: "X-Auth-Token value (defaults to local .msgmon/serve.json token when present)",
    })
    .option("dir", {
      type: "string",
      describe: "Local agent workspace directory (defaults to current directory)",
    })

export let configureClientCli = (cli: Argv) =>
  cli
    .usage("Usage: $0 <command> [options]")
    .command(
      "start",
      "Pull workspace snapshot, run an agent command, then push changes back",
      y =>
        withShared(y)
          .option("agent-command", {
            type: "string",
            describe: "Shell command to launch in the workspace, e.g. 'codex .'",
          })
          .option("force", {
            type: "boolean",
            default: false,
            describe: "Overwrite non-empty target directory",
          }),
      async argv => {
        let result = await startSession({
          serverUrl: argv.server,
          token: argv.token,
          dir: argv.dir,
          agentCommand: argv.agentCommand,
          force: argv.force,
        })
        console.log(JSON.stringify(result, null, 2))
      },
    )
    .command(
      "pull",
      "Pull the latest workspace snapshot from the server",
      y => withShared(y).option("force", {
        type: "boolean",
        default: false,
        describe: "Overwrite non-empty target directory",
      }),
      async argv => {
        let result = await syncPull({
          serverUrl: argv.server,
          token: argv.token,
          dir: argv.dir,
          force: argv.force,
        })
        console.log(JSON.stringify(result, null, 2))
      },
    )
    .command(
      "push",
      "Push local writable workspace changes back to the server",
      y => withShared(y),
      async argv => {
        let result = await syncPush({
          dir: argv.dir,
          serverUrl: argv.server,
          token: argv.token,
        })
        console.log(JSON.stringify(result, null, 2))
      },
    )
    .demandCommand(1, "Choose a command: start, pull, or push.")
    .strict()
    .help()

export let parseClientCli = (args: string[], scriptName = "msgmon client") =>
  configureClientCli(yargs(args).scriptName(scriptName)).parseAsync()
