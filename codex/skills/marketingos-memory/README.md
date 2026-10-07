# MarketingOS memory skill

Pull AI Research facts and recent Q&A into Codex, and push one chat back into MarketingOS. The secret stays in `MARKETINGOS_API_TOKEN`. The scripts never print it.

## Generate a token

1. Sign in to MarketingOS with an account that can use AI Research.
2. Open **API tokens** at `/dashboard/settings/api-tokens`.
3. Name the token and choose **Create token**.
4. Copy the `mos_` secret once. MarketingOS stores only its SHA-256 hash.
5. On the laptop, set:

```bash
export MARKETINGOS_API_TOKEN='mos_…'
export MARKETINGOS_API_URL='https://marketingos.example.com'
```

`MARKETINGOS_API_URL` is the origin only. `https://…` is required, except `http://localhost` or `http://127.0.0.1` with an optional port.

Revoke a token from the same page when a laptop should stop syncing. Create a new token for a new secret. The old secret does not start working again.

## Install

Copy this directory to `~/.codex/skills/marketingos-memory/`.

## Pull

```bash
node ~/.codex/skills/marketingos-memory/scripts/pull.mjs
node ~/.codex/skills/marketingos-memory/scripts/pull.mjs brand guide
```

Words after the command become the optional `q` search. The script prints facts, then questions and answer summaries.

## Push

Default push leaves review on. Open AI Research → Memory and choose **Review facts**.

```bash
node ~/.codex/skills/marketingos-memory/scripts/push.mjs --file ./chat.json
node ~/.codex/skills/marketingos-memory/scripts/push.mjs < thread.txt
```

Pass `--approve` only when the user asked to approve without review. That sends `autoApprove: true`.

A file that starts with `{` or `[` and parses as JSON is sent as a Codex export. Anything else is plain text. One command imports one chat.
