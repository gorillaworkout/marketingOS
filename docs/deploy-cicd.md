# Production CI/CD

Pushes to `main` deploy MarketingOS on the AWS VPS. The workflow also supports **Run workflow** (`workflow_dispatch`). A run always deploys `origin/main` on the server, because `scripts/deploy.sh` checks out that ref.

| Item | Value |
|------|--------|
| App path | `/home/ubuntu/apps/marketingos` |
| PM2 process | `marketingos` |
| App port | `3021` |
| Public URL | https://marketing-aws.gorillaworkout.id |
| Workflow | `.github/workflows/deploy-production.yml` |
| Deploy script | `/home/ubuntu/apps/marketingos/scripts/deploy.sh` |
| Runner labels | `self-hosted`, `linux`, `aws`, `marketingos` |

## Why the job runs on the VPS

The production security group blocks inbound TCP 22. A GitHub-hosted `ubuntu-latest` runner cannot open SSH to the VPS, so the workflow does not SSH and does not read `MARKETINGOS_DEPLOY_*` secrets.

The deploy job runs on a self-hosted GitHub Actions runner on the VPS. It executes:

```bash
bash /home/ubuntu/apps/marketingos/scripts/deploy.sh
```

The runner must be registered with labels `self-hosted`, `linux`, `aws`, and `marketingos`. It must run as a user that can update `/home/ubuntu/apps/marketingos` and invoke `git`, `node`, `npm`, `pm2`, and `curl` (the `ubuntu` user). The job timeout is 40 minutes so `npm ci` and `npm run build` can finish.

The earlier GitHub-hosted SSH path is retired.

## What the VPS script does

`scripts/deploy.sh` is the deploy. It:

1. Aborts if neither `.env` nor `.env.local` exists. It does this before any git update.
2. Runs `git fetch origin`, `git checkout main`, and `git reset --hard origin/main`.
3. Runs `npm ci`, `npm run db:migrate`, `npm run build`, and `pm2 restart marketingos`.
4. Polls `http://127.0.0.1:3021/api/health` until it returns HTTP 200 (30 attempts, 2 seconds between attempts, 5 second request timeout).

The script does not run `git clean`. `.env`, `.env.local`, and the database stay on the server. It does not print secret values. Put production `DATABASE_URL` in `.env`; `npm run db:migrate` loads that file. Next.js also reads `.env.local` when that file is present.

After the script exits 0, the GitHub Actions job requests `https://marketing-aws.gorillaworkout.id/api/health` and reports that status.

Overlapping deploys for the same ref use one concurrency group with cancel-in-progress. A newer push cancels the in-flight job. The next run executes the full script again. Database migrations are idempotent.

## Manual deploy

An admin SSH session can still deploy with the same script. No security group change is required for that path:

```bash
bash /home/ubuntu/apps/marketingos/scripts/deploy.sh
```

Do not commit `.env` or `.env.local`. The app checkout and the self-hosted runner must already be on the VPS before the first Actions run.
