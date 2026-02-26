# mailmaster

`mailmaster` is a Gmail CLI for account auth, account discovery, message search/read, and message sending (including threading and attachments).

## Install

To install this repo as a global command on your machine:

```bash
npm link
```

Then run:

```bash
mailmaster --help
```

To remove the global link later:

```bash
npm unlink -g mailmaster
```

## Configuration Resolution

`mailmaster` supports both local project config and global home config.

- Credentials path resolution:
  - `./credentials.json` (preferred if present)
  - `~/.mailmaster/credentials.json` (fallback)
- Token read locations:
  - `./tokens/*.json`
  - `~/.mailmaster/tokens/*.json`
- Token write location (`mailmaster auth`):
  - `./tokens/` when local config exists
  - otherwise `~/.mailmaster/tokens/`

Accounts are token filenames without `.json` (for example `tokens/personal.json` => account `personal`).

## Top-Level Usage

```bash
mailmaster --help
mailmaster help
mailmaster help mail
mailmaster help auth
mailmaster help accounts
```

Top-level commands:

- `mailmaster mail ...`
- `mailmaster auth ...`
- `mailmaster accounts ...`

Global flag:

- `--verbose` / `-v`: print diagnostic information to `stderr`

## Command Reference

### `mailmaster auth`

Runs OAuth and writes a token for an account.

```bash
mailmaster auth --account=personal
```

Output:

- prints `Saved <absolute-path-to-token>`

### `mailmaster accounts`

Lists token-backed accounts available from local/global token directories.

```bash
mailmaster accounts --format=json
mailmaster accounts --format=text
```

Output contract:

- `json` (default): JSON array of account names
- `text`: one account per line

### `mailmaster mail`

Subcommands:

- `search <query>`
- `read <messageId>`
- `send`

#### Search

```bash
mailmaster mail --account=personal search "from:alerts@example.com newer_than:7d"
```

Output:

- JSON array of Gmail message references (`id`, `threadId`, etc.)

#### Read

```bash
mailmaster mail --account=personal read 190cf9f55b05efcc
```

Output:

- JSON object with message metadata and headers (`From`, `To`, `Subject`, `Date`)

#### Send

Minimal send:

```bash
mailmaster mail --account=personal send \
  --to you@example.com \
  --subject "Hi" \
  --body "Hello" \
  --yes
```

Reply/thread example:

```bash
mailmaster mail --account=personal send \
  --to you@example.com \
  --subject "Re: Status" \
  --body "Following up" \
  --thread-id 190cb53f30f3d1aa \
  --in-reply-to "<original@message.id>" \
  --references "<original@message.id>" \
  --reply-to replies@example.com \
  --yes
```

Attachments/recipient example:

```bash
mailmaster mail --account=personal send \
  --to you@example.com \
  --cc team@example.com \
  --bcc audit@example.com \
  --subject "Report" \
  --body "Attached" \
  --attach ./report.pdf \
  --attach ./metrics.csv \
  --yes
```

Important send flags:

- `--yes` required safety flag (send is refused without it)
- `--to` required
- `--cc`, `--bcc`, `--attach` support repeated and comma-separated values
- `--thread-id` sets Gmail API thread routing
- `--in-reply-to` / `--references` set RFC 5322 threading headers
- `--from` optional `From` header (must be authorized in Gmail sender settings)
- `--message-id` optional Message-ID override

Output:

- JSON send response from Gmail API (includes fields such as `id`, `threadId`)

## Agent-Friendly Notes

- `mail` commands emit JSON responses suitable for automation.
- `accounts` emits JSON by default.
- `--verbose` writes diagnostics to `stderr` and does not change JSON payload shape.
