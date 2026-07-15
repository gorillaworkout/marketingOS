# Backend Agent — MarketingOS

## Role
⚙️ Backend Developer — responsible for API routes, database, auth, and business logic.

## Rules
1. **Only modify** `src/lib/*.ts`, `src/app/api/**/*.ts`, `database.ts`
2. **Never touch** `src/app/**/*.tsx` (frontend files)
3. **Always use** parameterized queries (prevent SQL injection)
4. **Always use** `getSession(request)` for auth
5. **Always use** `getDb()` (async) for database access
6. **Always call** `saveDbToDisk()` after writes
7. **Error handling**: try-catch all DB/API operations, return proper HTTP status codes
8. **Validation**: validate all input before processing

## Quality Checklist
- [ ] Input validation on all endpoints
- [ ] Auth check on all protected routes
- [ ] Parameterized SQL queries (no string interpolation)
- [ ] Proper HTTP status codes (200, 201, 400, 401, 404, 500)
- [ ] Error messages are safe (no internal details exposed)
- [ ] Database operations are atomic (transaction where needed)
- [ ] No memory leaks (close statements, free resources)

## Tech Stack
- Next.js 16.2 (App Router API routes)
- sql.js (WASM SQLite) with WrappedDb class
- TypeScript
- bcryptjs for password hashing
- uuid for ID generation

## Database
- Uses sql.js WrappedDb (NOT better-sqlite3)
- `getDb()` returns `Promise<WrappedDb>`
- `WrappedDb.prepare()` returns object with `.bind()`, `.step()`, `.getAsObject()`, `.all()`, `.run()`, `.free()`
- Store embeddings as JSON string in TEXT column
- FTS5 virtual tables for full-text search

## File Structure
```
src/lib/
├── database.ts        # DB schema, WrappedDb class, helpers
├── auth.ts            # getSession() middleware
├── openai.ts          # AI engine (generateContent, generateMultiStep)
├── embeddings.ts      # Embedding system (OpenAI + TF-IDF + Hash)
├── rate-limit.ts      # Rate limiting middleware
└── *.ts               # Other utilities

src/app/api/
├── auth/route.ts              # Login/logout/check
├── social-post/generate/      # Social post generation
├── video-script/generate/     # Video script generation
├── event-plan/generate/       # Event plan generation
├── generate-image/            # Image generation
├── feedback/                  # Rating system
├── knowledge/                 # Knowledge graph APIs
│   ├── save/
│   ├── search/
│   ├── graph/
│   ├── style/
│   └── analyze/
├── settings/model/            # Model preferences
├── brand-guidelines/          # Brand guidelines CRUD
├── templates/                 # Template CRUD
├── calendar/                  # Calendar CRUD
└── dashboard/                 # Stats, history, tokens
```
