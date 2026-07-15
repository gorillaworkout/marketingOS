# MarketingOS — Multi-Agent Team

## 🎯 Team Structure

| Agent | Profile | Role | Responsibility |
|---|---|---|---|
| 🎨 **Frontend** | `fe-agent` | UI/UX Developer | React components, styling, UX, responsive design |
| ⚙️ **Backend** | `be-agent` | Backend Developer | API routes, database, auth, business logic |
| 🧪 **QA** | `qa-agent` | Quality Assurance | Testing, bug detection, code review, edge cases |
| 📋 **PM** | `pm-agent` | Project Manager | Planning, coordination, documentation, delivery |

## 🔄 Workflow

```
PM creates task
    ↓
PM assigns to Frontend or Backend
    ↓
Agent implements
    ↓
QA reviews + tests
    ↓
PM approves + merges
```

## 📁 File Ownership

| Area | Owner | Others |
|---|---|---|
| `src/app/**/*.tsx` | Frontend | QA reads |
| `src/app/api/**/*.ts` | Backend | QA reads |
| `src/lib/*.ts` | Backend | QA reads |
| `*.test.ts` | QA | — |
| `docs/` | PM | All contribute |
| `package.json` | PM | All suggest |
