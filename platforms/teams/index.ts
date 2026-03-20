/**
 * Microsoft Teams platform stub.
 *
 * Credentials layout (mirrors the mail pattern):
 *   .msgmon/teams/credentials.json   — Azure AD app registration (client_id, client_secret, tenant_id)
 *   .msgmon/teams/tokens/<account>.json — OAuth tokens per tenant/user
 *
 * Recommended off-the-shelf packages:
 *   @microsoft/microsoft-graph-client  — Microsoft Graph API client
 *   @azure/identity                    — Azure AD auth (client credentials, device code, etc.)
 *   @azure/msal-node                   — MSAL for Node.js (interactive + daemon flows)
 *
 * Planned CLI subcommands (not yet implemented):
 *   msgmon teams auth       — Run Azure AD OAuth / device-code flow
 *   msgmon teams accounts   — List configured Teams tenants
 *   msgmon teams search     — Search Teams messages via Graph API
 *   msgmon teams read       — Read a message by team/channel/message id
 *   msgmon teams send       — Post a message to a Teams channel
 */

import yargs from "yargs"
import type { Argv } from "yargs"

export let configureTeamsCli = (cli: Argv) =>
  cli
    .usage("Usage: $0 <command> [options]")
    .option("account", {
      type: "string",
      default: "default",
      describe: "Teams tenant account name (uses .msgmon/teams/tokens/<account>.json)",
    })
    .option("verbose", {
      alias: "v",
      type: "boolean",
      default: false,
      describe: "Print diagnostic details to stderr",
    })
    .command("auth", "Run Azure AD OAuth flow and store token (not yet implemented)", () => {}, () => {
      console.error("Not yet implemented. See platforms/teams/index.ts for the planned approach.")
      process.exit(1)
    })
    .command("accounts", "List configured Teams tenants (not yet implemented)", () => {}, () => {
      console.error("Not yet implemented.")
      process.exit(1)
    })
    .command("search <query>", "Search Teams messages (not yet implemented)", () => {}, () => {
      console.error("Not yet implemented.")
      process.exit(1)
    })
    .command("read <teamId> <channelId> <messageId>", "Read a Teams message (not yet implemented)", () => {}, () => {
      console.error("Not yet implemented.")
      process.exit(1)
    })
    .command("send", "Post a message to a Teams channel (not yet implemented)", () => {}, () => {
      console.error("Not yet implemented.")
      process.exit(1)
    })
    .demandCommand(1, "Choose a command: auth, accounts, search, read, or send.")
    .strict()
    .help()

export let parseTeamsCli = (args: string[], scriptName = "teams") =>
  configureTeamsCli(yargs(args).scriptName(scriptName)).parseAsync()
