# Plan: Add Slack platform

## Key design decisions

### Auth approach
Use **bot tokens** (`xoxb-`) stored in `.messagemon/slack/tokens/<account>.json`.
No OAuth flow — user manually creates a Slack app, installs to workspace, copies the bot token.
This is simpler and more reliable than OAuth for CLI tools. The `auth` command will
prompt for a token string and save it (like a `configure` step, not a browser flow).

### Required Slack app scopes
- `channels:history` — read public channel messages
- `channels:read` — list public channels
- `groups:history` — read private channel messages (optional)
- `groups:read` — list private channels (optional)
- `im:history` — read DMs (optional)
- `mpim:history` — read group DMs (optional)
- `users:read` — resolve user IDs to names

### Query model
Slack has no Gmail-style query syntax. Instead, `--query` will accept a
**channel name or ID** (e.g. `#general`, `C01234ABC`). For `ingest`/`watch`,
the source will list messages from specified channels. A `--channels` flag
will accept multiple channels.

For `slack search`, use Slack's `search.messages` API (requires user token with
`search:read` scope — documented as available but with caveats).

### Message ID
Use `{channel_id}:{ts}` as the unified message ID. This is globally unique
within a workspace and maps directly to Slack's canonical identifier.

### SDK
Add `@slack/web-api` as a dependency. Lightweight, official, well-maintained.

---

## Implementation steps

### 1. Install dependency
```
npm install @slack/web-api
```

### 2. Create `platforms/slack/auth.ts`
- `slack auth` command: reads token from stdin or `--token` flag
- Saves to `.messagemon/slack/tokens/<account>.json` as `{ "token": "xoxb-..." }`
- Validates token by calling `auth.test` API
- Prints workspace name and bot user on success

### 3. Create `platforms/slack/accounts.ts`
- `slack accounts` command: lists token files under `.messagemon/slack/tokens/`
- Reuses `resolveAllTokenDirs("slack")` from CliConfig
- Same JSON/text output format as mail accounts

### 4. Create `platforms/slack/toUnifiedMessage.ts`
- Converts Slack `conversations.history` message objects to `UnifiedMessage`
- Maps: `ts` → ID, `text` → bodyText, `user` → from (resolved via users.info cache)
- Populates `SlackMetadata` with channelId, ts, threadTs, permalink
- Handles attachments (Slack files → `UnifiedAttachment`)
- Synthesizes subject from channel name + first line of text

### 5. Create `platforms/slack/SlackSource.ts`
- Implements `MessageSource` interface
- `listMessages()` async generator:
  - Loads bot token for account
  - Calls `conversations.history` for each channel (from query/channels param)
  - Handles cursor-based pagination
  - Yields `UnifiedMessage` via `toUnifiedMessage()`
- Exports `markSlackRead` (no-op or mark with reaction/emoji)
- User ID → name resolution cache (batch via `users.info`)

### 6. Update `platforms/slack/index.ts`
- Wire up real `auth` and `accounts` commands
- Implement `search` using `search.messages` (user token required, document this)
- Implement `read` — fetch single message by channel + ts
- Implement `send` — post message to channel via `chat.postMessage`
- Remove stub error messages

### 7. Update `src/ingest/cli.ts` — multi-platform dispatch
- Add `--platform` flag (default: infer from account name or "mail")
- Update `resolveSources()` to dispatch to `slackSource` when platform is "slack"
- Account naming convention: `slack:workspace-name` dispatches to Slack,
  plain names dispatch to mail (backward compatible)

### 8. Update `cli/index.ts`
- No structural changes needed — `slack` command already dispatched
- Update help text to reflect implemented status

### 9. Update README
- Add Slack setup instructions
- Document Slack-specific flags and behavior
