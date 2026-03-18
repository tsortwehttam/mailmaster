# Mailmon TODOs

## High Priority

### 1. Human-readable output mode for `read`
`read` returns the raw Gmail API payload, requiring manual base64 decoding and MIME tree walking to extract text. Add a `--format=text` option that returns decoded body + basic headers.

### 2. Thread-level fetch
Messages include `threadId` but there's no way to fetch all messages in a thread in order. Add a `thread <threadId>` command (or `read --thread`) to reconstruct full conversations in one call.

### 3. Attachment download on `read`
Attachment filenames are visible in the payload but `body.data` is absent (Gmail uses a separate `attachments.get` API call). Add a `--save-attachments ./dir` flag on `read` or a standalone `attachment` command to retrieve attachments.

### 4. Compact search output format
The full nested Gmail payload with all headers is hard to scan when triaging many results. Add `--format=table` or `--format=summary` on search for a compact view: date, from, subject, snippet.

### 5. Body preview in search results
`--fetch=metadata` gives headers but no body preview. `--fetch=full` returns everything but is massive. Add a middle ground like `--fetch=summary` that includes headers + decoded text body (truncated to N chars) to reduce round trips.

## Medium Priority

### 6. Result count in search output
Add a total result count indicator in search output (e.g., `"totalResults": 47, "returned": 20`) or a `--dry-run` flag to help with pagination decisions.

### 7. `accounts` should scan all token resolution paths
`accounts` returned `[]` even though a token existed in `./mailmon/tokens/`. It should scan all resolution paths (cwd, install dir, home dir).

## Minor

### 8. Consistent query interface
`search` takes a positional query arg while `export` uses a `--query` flag. Align these for consistency.
