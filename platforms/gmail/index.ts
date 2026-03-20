/**
 * Gmail platform — re-exports the CLI parsers so the top-level
 * dispatcher can register them under `msgmon gmail …`.
 */
export { parseGmailCli, configureGmailCli } from "./mail"
export { parseAuthCli, configureAuthCli } from "./auth"
export { parseAccountsCli, configureAccountsCli } from "./accounts"
export { toUnifiedMessage } from "./toUnifiedMessage"
export { gmailSource, markGmailRead, fetchGmailAttachment } from "./MailSource"
