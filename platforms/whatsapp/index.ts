/**
 * WhatsApp Business platform stub.
 *
 * Credentials layout (mirrors the mail pattern):
 *   .msgmon/whatsapp/credentials.json   — Meta app credentials (app_id, app_secret)
 *   .msgmon/whatsapp/tokens/<account>.json — Access tokens per business account / phone number
 *
 * Recommended off-the-shelf packages:
 *   whatsapp-web.js          — Unofficial WhatsApp Web client (personal accounts)
 *   whatsapp-api-js          — WhatsApp Cloud API wrapper (business accounts)
 *
 * Planned CLI subcommands (not yet implemented):
 *   msgmon whatsapp auth       — Store/verify WhatsApp Cloud API token
 *   msgmon whatsapp accounts   — List configured phone numbers / business accounts
 *   msgmon whatsapp read       — Read a message by id
 *   msgmon whatsapp send       — Send a message to a phone number
 */

import yargs from "yargs"
import type { Argv } from "yargs"

export let configureWhatsAppCli = (cli: Argv) =>
  cli
    .usage("Usage: $0 <command> [options]")
    .option("account", {
      type: "string",
      default: "default",
      describe: "WhatsApp business account name (uses .msgmon/whatsapp/tokens/<account>.json)",
    })
    .option("verbose", {
      alias: "v",
      type: "boolean",
      default: false,
      describe: "Print diagnostic details to stderr",
    })
    .command("auth", "Store/verify WhatsApp Cloud API access token (not yet implemented)", () => {}, () => {
      console.error("Not yet implemented. See platforms/whatsapp/index.ts for the planned approach.")
      process.exit(1)
    })
    .command("accounts", "List configured WhatsApp business accounts (not yet implemented)", () => {}, () => {
      console.error("Not yet implemented.")
      process.exit(1)
    })
    .command("read <messageId>", "Read a WhatsApp message (not yet implemented)", () => {}, () => {
      console.error("Not yet implemented.")
      process.exit(1)
    })
    .command("send", "Send a WhatsApp message (not yet implemented)", () => {}, () => {
      console.error("Not yet implemented.")
      process.exit(1)
    })
    .demandCommand(1, "Choose a command: auth, accounts, read, or send.")
    .strict()
    .help()

export let parseWhatsAppCli = (args: string[], scriptName = "whatsapp") =>
  configureWhatsAppCli(yargs(args).scriptName(scriptName)).parseAsync()
