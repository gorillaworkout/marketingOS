# Production CI/CD

Pushes to `main` deploy MarketingOS to the AWS VPS. The workflow also supports **Run workflow** (`workflow_dispatch`). A run always deploys `origin/main` on the server.

| Item | Value |
|------|--------|
| App path | `/home/ubuntu/apps/marketingos` |
| PM2 process | `marketingos` |
| App port | `3021` |
| Public URL | https://marketing-aws.gorillaworkout.id |
| Workflow | `.github/workflows/deploy-production.yml` |
| Remote script | `scripts/deploy.sh` |

## What the VPS script does

`scripts/deploy.sh` is the deploy. It:

1. Aborts if neither `.env` nor `.env.local` exists. It does this before any git update.
2. Runs `git fetch origin`, `git checkout main`, and `git reset --hard origin/main`.
3. Runs `npm ci`, `npm run db:migrate`, `npm run build`, and `pm2 restart marketingos`.
4. Polls `http://127.0.0.1:3021/api/health` until it returns HTTP 200 (30 attempts, 2 seconds between attempts, 5 second request timeout).

The script does not run `git clean`. `.env`, `.env.local`, and the database stay on the server. It does not print secret values. Put production `DATABASE_URL` in `.env`; `npm run db:migrate` loads that file. Next.js also reads `.env.local` when that file is present.

After the SSH session exits 0, the GitHub Actions job requests `https://marketing-aws.gorillaworkout.id/api/health` and reports that status.

Overlapping deploys for the same ref use one concurrency group with cancel-in-progress. A newer push cancels the in-flight GitHub job and drops its SSH session. The next run executes the full script again. Database migrations are idempotent.

## GitHub Actions secrets

Add these under **Settings → Secrets and variables → Actions** on `gorillaworkout/marketingOS`.

| Secret | Required | What to store |
|--------|----------|----------------|
| `MARKETINGOS_DEPLOY_SSH_KEY` | yes | Private key PEM for the VPS deploy key |
| `MARKETINGOS_DEPLOY_HOST` | yes | VPS host. Current production host is `16.78.68.56` |
| `MARKETINGOS_DEPLOY_USER` | yes | SSH user. Production user is `ubuntu` |
| `MARKETINGOS_DEPLOY_KNOWN_HOSTS` | no | `ssh-keyscan` output for the host. When this secret is empty, the workflow runs `ssh-keyscan` itself |

Do not commit the private key, `.env`, or `.env.local`.

## Authorized keys

The deploy key on the VPS must keep this forced command. GitHub Actions cannot pass a different remote command:

```
command="/home/ubuntu/apps/marketingos/scripts/deploy.sh",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty
```

The workflow opens SSH with `StrictHostKeyChecking=yes` and does not request a PTY. The key options above reject port forwarding, X11, agent forwarding, and PTY allocation.

## First deploy after this file is committed

The copy of `scripts/deploy.sh` already on the VPS is untracked. Git will not overwrite that file during `git reset --hard`, and the forced command still runs that copy, so the first merge does not replace it by itself.

Add the Actions secrets first. From an admin SSH session (a key that is not the forced-command deploy key), install the committed script once, then run it. After this bootstrap, **workflow_dispatch** and later pushes to `main` deploy on their own:

```bash
cd /home/ubuntu/apps/marketingos
git fetch origin
git show origin/main:scripts/deploy.sh > /tmp/marketingos-deploy.sh
install -m 755 /tmp/marketingos-deploy.sh scripts/deploy.sh
rm -f /tmp/marketingos-deploy.sh
bash scripts/deploy.sh
```

That run moves the untracked script aside, checks out the tracked `scripts/deploy.sh` from `origin/main`, builds, restarts PM2, and waits for local health. Later pushes to `main` deploy on their own.

If secrets are not set yet, the merge commit's workflow run fails at the secret check. After the secrets exist, use **Actions → Deploy production → Run workflow**.
