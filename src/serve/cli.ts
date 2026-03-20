import yargs from "yargs"
import type { Argv } from "yargs"
import { startServer } from "./server"

export let configureServeCli = (cli: Argv) =>
  cli
    .usage("Usage: $0 [options]")
    .option("port", {
      type: "number",
      default: 3271,
      describe: "Port to listen on",
    })
    .option("host", {
      type: "string",
      default: "127.0.0.1",
      describe: "Host/address to bind to",
    })
    .option("token", {
      type: "string",
      demandOption: true,
      describe: "Secret token for X-Auth-Token authentication (required)",
    })
    .option("verbose", {
      alias: "v",
      type: "boolean",
      default: false,
      describe: "Print diagnostic details to stderr",
    })
    .example("$0 --token=mysecret", "Start server on default port with auth token")
    .example("$0 --port=8080 --host=0.0.0.0 --token=mysecret", "Bind to all interfaces on port 8080")
    .epilog(
      [
        "Authentication:",
        "  Every request must include the header: X-Auth-Token: <token>",
        "  Requests without a valid token receive 401 Unauthorized.",
        "",
        "Endpoints (all POST, JSON body):",
        "  /api/mail/search      — Search Gmail messages",
        "  /api/mail/count       — Count Gmail results",
        "  /api/mail/thread      — Get all messages in a thread",
        "  /api/mail/read        — Read a single message",
        "  /api/mail/send        — Send an email",
        "  /api/mail/mark-read   — Mark a message as read",
        "  /api/mail/archive     — Archive a message",
        "  /api/mail/accounts    — List configured mail accounts",
        "  /api/slack/search     — Search Slack messages",
        "  /api/slack/read       — Read a Slack message",
        "  /api/slack/send       — Post a Slack message",
        "  /api/slack/accounts   — List configured Slack workspaces",
        "  /api/ingest           — One-shot ingest across accounts",
        "",
        "  GET /api/health       — Health check (still requires auth)",
        "",
        "Request bodies are validated with Zod. Errors return { ok: false, error: '...' }.",
      ].join("\n"),
    )
    .strict()
    .help()

export let parseServeCli = async (args: string[], scriptName = "messagemon serve") => {
  let argv = await configureServeCli(yargs(args).scriptName(scriptName)).parseAsync()
  await startServer({
    port: argv.port,
    host: argv.host,
    token: argv.token,
    verbose: argv.verbose,
  })
}
