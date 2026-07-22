# MarketingOS

AI-powered marketing suite untuk **Dupoin Futures**. Generate social media posts, video scripts, dan event plans dengan 3 variasi gaya sekaligus (Bold, Professional, Creative).

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16.2 (App Router) |
| Language | TypeScript 5 |
| Styling | Tailwind CSS 4 |
| Database | PostgreSQL (`pg` connection pool) |
| AI Providers | OpenRouter API + Codex CLI |
| Image Gen | GPT-5-Image (OpenRouter) + FAL.ai |

## Features

### Content Generation
- **Social Post Generator** — 3 variasi gaya (Bold/Professional/Creative) dengan perbandingan side-by-side, editable image prompt, streaming progress
- **Video Script Generator** — Script lengkap dengan scene breakdown
- **Event Plan Generator** — Rencana event detail dengan timeline

### Knowledge System
- **Learning dari Selection** — Setiap kali user memilih output, sistem menyimpan preference dan belajar
- **Semantic Search** — Cari konten berdasarkan makna, bukan keyword
- **Knowledge Graph** — Visualisasi D3.js hubungan antar konten
- **Style Analysis** — AI menganalisis pola gaya konten team

### Management Tools
- **Brand Guidelines** — CRUD aturan brand voice
- **Content Calendar** — Kalender bulanan untuk scheduling
- **Template Library** — Simpan dan reuse prompt templates
- **Token Usage Analytics** — Dashboard tracking penggunaan AI tokens

### AI Engine
- **Dual Provider** — OpenRouter (text models) + Codex CLI (GPT-5.6 series)
- **Per-Task Model Selection** — Beda model untuk caption vs image prompt vs video script
- **Smart System Prompts** — Context-aware prompts dengan brand guidelines
- **No Silent Fallback** — Jika model error, tampilkan error (tidak switch diam-diam)

## Quick Start

```bash
# Install dependencies
npm install

# Setup environment
cp .env.example .env
# Set DATABASE_URL and the API keys required by your deployment

# Apply the canonical PostgreSQL schema (seeds five default users only on an empty DB)
npm run db:migrate

# Run development server
npm run dev
```

Open http://localhost:3000

## Environment Variables

```env
# OpenRouter API (text + image generation)
OPENROUTER_API_KEY=sk-or-...

# JWT Secret untuk auth
JWT_SECRET=your-secret-key

# Optional: Embedding model
EMBEDDING_MODEL=text-embedding-3-small
```

**Codex CLI** di-authenticate via `~/.codex/config.toml` dan `~/.codex/auth.json` (OAuth ChatGPT Plus). Tidak perlu env var.

## Project Structure

```
marketingos/
├── src/
│   ├── app/
│   │   ├── api/                    # 19 API routes
│   │   │   ├── auth/               # Login/register
│   │   │   ├── social-post/        # 3-option generation
│   │   │   ├── video-script/       # Script generation
│   │   │   ├── event-plan/         # Event plan generation
│   │   │   ├── generate-image/     # Image generation
│   │   │   ├── knowledge/          # Knowledge system (5 routes)
│   │   │   ├── brand-guidelines/   # Brand CRUD
│   │   │   ├── calendar/           # Content calendar
│   │   │   ├── templates/          # Prompt templates
│   │   │   ├── dashboard/          # Stats, tokens, history
│   │   │   ├── feedback/           # User feedback
│   │   │   └── settings/model/     # Model preferences
│   │   └── dashboard/              # 10 dashboard pages
│   │       ├── social-post/
│   │       ├── video-script/
│   │       ├── event-plan/
│   │       ├── knowledge/
│   │       ├── brand-guidelines/
│   │       ├── templates/
│   │       ├── calendar/
│   │       ├── tokens/
│   │       └── history/
│   └── lib/
│       ├── database.ts             # async PostgreSQL helpers
│       ├── openai.ts               # Dual AI provider
│       ├── embeddings.ts           # OpenAI embeddings
│       ├── auth.ts                 # JWT auth
│       └── rate-limit.ts           # 30 req/min/IP
├── docs/
│   ├── API.md                      # API documentation
│   └── USER-GUIDE.md               # User guide
└── package.json
```

## Database and deployment

Production uses PostgreSQL. Set `DATABASE_URL` to a standard PostgreSQL connection string, run `npm run db:migrate` during deployment before `npm start`, and ensure the deployment platform can reach the database. The migration is idempotent; default users are created only when `users` is empty.

To copy an existing local SQLite file without modifying it, configure `DATABASE_URL` and run:

```bash
npm run db:import-sqlite
```

The importer reads `data/marketingos.db` read-only, preserves IDs and timestamps, loads tables in foreign-key-safe order, and skips rows that already exist. If legacy SQLite rows refer to a deleted task, it creates an archived placeholder task with the original ID so the corresponding token logs/assets/calendar links remain intact.

PostgreSQL contains these core tables:

| Tabel | Purpose |
|-------|---------|
| users | User accounts |
| tasks | Generated content |
| token_logs | AI token usage |
| brand_guidelines | Brand voice rules |
| content_calendar | Scheduled content |
| templates | Prompt templates |
| knowledge_entries | Saved selections |
| knowledge_edges | Similarity links |
| user_style_preferences | Per-user style |
| global_style_profile | Team-level style |
| user_preferences | Global settings |
| task_model_preferences | Per-task model |

## Documentation

- [API Documentation](docs/API.md) — Semua 19 API endpoints
- [User Guide](docs/USER-GUIDE.md) — Panduan lengkap untuk marketing team

## Development

```bash
# Type checking
npx tsc --noEmit

# Build
npm run build

# Start production
npm start
```

## License

Private — Dupoin Futures internal use only.
