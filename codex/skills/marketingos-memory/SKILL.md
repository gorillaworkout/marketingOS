---
name: marketingos-memory
description: Pull AI Research memory from MarketingOS and push one Codex chat back for review. Uses MARKETINGOS_API_TOKEN and MARKETINGOS_API_URL. Never print the token.
---

# MarketingOS memory

Sync one person's AI Research memory between MarketingOS and this laptop. MarketingOS stores only a hash of the token. Review stays in AI Research → Memory unless the user explicitly asks to approve without review.

## Setup

The user creates a token at `/dashboard/settings/api-tokens` and sets:

- `MARKETINGOS_API_TOKEN` — the full `mos_` secret, shown once
- `MARKETINGOS_API_URL` — origin only, such as `https://marketingos.example.com`

If either variable is missing, stop. Tell the user to create a token at `/dashboard/settings/api-tokens` and set both variables. Do not guess an origin.

Install this directory at `~/.codex/skills/marketingos-memory/`. Run the scripts below. They read the environment themselves.

Do not print the token. Do not write it to a file. Do not include it in chat text. Do not print a shell command that already contains the expanded secret.

The scripts call the API only for `https` origins, or `http://localhost` / `http://127.0.0.1` with an optional port.

## Pull

Optional words after pull become the search query. The script trims it and cuts it at 200 characters.

```bash
node scripts/pull.mjs
node scripts/pull.mjs brand guide
```

Show each fact's kind and content, then each question and answer summary. When memory is off, also say: `Memory is off. Dupoin AI will not use these until you turn memory on in AI Research.`

## Push

Push the current thread, or one file the user names. One push is one chat. Do not split an archive into several requests.

- A file whose first non-whitespace character is `{` or `[` and that parses as JSON is sent with `source: codex`.
- Any other file is sent with `source: text`.
- The current thread is plain text. Each user turn starts `User: ` and each assistant turn starts `Assistant: `. `source` is `text`.

`autoApprove` is false unless the user explicitly asks to approve without review. Only then pass `--approve`, which sends `autoApprove: true`.

Before push, drop any line whose trimmed value equals `MARKETINGOS_API_TOKEN`. If the text is longer than 200,000 characters, do not call the API. Say the chat is over the import limit.

```bash
node scripts/push.mjs --file ./chat.json
node scripts/push.mjs --approve < thread.txt
```

After `autoApproved: false` and status `review`, say to open AI Research → Memory, find that import title, and choose **Review facts**. After `extract_failed`, say to open Memory and choose **Retry extract**. After `autoApproved: true`, report the four approve counts. After 409, say the chat is already imported and to open it from Memory. Do not send the chat again.

A multi-chat JSON file is still one request. If the API returns `Import one chat at a time.`, show that sentence.
