import { authenticate } from "@google-cloud/local-auth"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import yargs from "yargs"
import { hideBin } from "yargs/helpers"
import {
  DEFAULT_ACCOUNT,
  GMAIL_SCOPES,
  resolveCredentialsPath,
  resolveTokenWriteDir,
  resolveTokenWritePathForAccount,
} from "../../src/CliConfig"
import type { Argv } from "yargs"
import { verboseLog } from "../../src/Verbose"

let authForAccount = async (account: string, verbose = false) => {
  let credentialsPath = resolveCredentialsPath("gmail")
  let tokenDir = resolveTokenWriteDir("gmail")
  let tokenPath = resolveTokenWritePathForAccount(account, "gmail")
  verboseLog(verbose, "auth target", { account, credentialsPath, tokenDir, tokenPath })

  fs.mkdirSync(tokenDir, { recursive: true })
  let auth = await authenticate({ keyfilePath: credentialsPath, scopes: GMAIL_SCOPES })
  fs.writeFileSync(tokenPath, JSON.stringify(auth.credentials, null, 2))
  console.log(`Saved ${tokenPath}`)
}

export let configureAuthCli = (cli: Argv) =>
  cli
    .usage("Usage: $0 [options]")
    .option("account", {
      type: "string",
      default: DEFAULT_ACCOUNT,
      describe: "Token account name (writes .msgmon/gmail/tokens/<account>.json)",
    })
    .option("verbose", {
      alias: "v",
      type: "boolean",
      default: false,
      describe: "Print diagnostic details to stderr",
    })
    .example("$0 --account=personal", "Run OAuth and save token to .msgmon/gmail/tokens/personal.json")
    .epilog(
      [
        "Output:",
        "- Prints `Saved <absolute token path>` on success.",
        "- The token file is used by `gmail` commands via the same `--account` value.",
        "- Reads credentials from `./.msgmon/gmail/credentials.json`, then `<install-dir>/.msgmon/gmail/credentials.json`, then `~/.msgmon/gmail/credentials.json`.",
        "- Writes token to `./.msgmon/gmail/tokens/` in the current working directory.",
      ].join("\n"),
    )
    .strict()
    .help()

export let parseAuthCli = (args: string[], scriptName = "auth") =>
  configureAuthCli(yargs(args).scriptName(scriptName))
    .parseAsync()
    .then(argv => authForAccount(argv.account, argv.verbose))

export let runAuthCli = (args = hideBin(process.argv), scriptName = "auth") =>
  parseAuthCli(args, scriptName).catch(e => {
    console.error(e)
    process.exit(1)
  })

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  runAuthCli()
}
