# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Telegram Bot (`artifacts/api-server/src/bot/`)

Telegram task management bot with Google Sheets integration and AI assistant.

### Required Environment Secrets

| Secret | Description |
|---|---|
| `TELEGRAM_BOT_TOKEN` | From BotFather — required to start the bot |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Full JSON of the Google Service Account credentials |
| `GOOGLE_SPREADSHEET_ID` | ID from the Google Sheets URL |
| `ADMIN_TELEGRAM_ID` | Telegram user ID of the admin |

AI integration is pre-configured via Replit AI Integrations (no API key needed):
- `AI_INTEGRATIONS_OPENAI_BASE_URL` — auto-provisioned
- `AI_INTEGRATIONS_OPENAI_API_KEY` — auto-provisioned

### Roles

- `admin` — full access, sends tasks to division heads
- `division_head` — manages their division, sends tasks to employees
- `employee` — receives tasks, submits results, checks in with location

### Bug Fixes Applied

1. **Keyboard buttons treated as task content** — keyboard button texts (e.g. "📊 Statistika") were accidentally saved as task descriptions when admin/head was in task-creation flow
2. **`saveTask` column range mismatch** — `A:M` (13 cols) was missing the `mediaType` column; fixed to `A:N` (14 cols)
3. **Duplicate callback handlers** — `common.ts` re-handled `allow_user_`/`deny_user_`/`role_head_`/`assign_div_` causing double execution; removed duplicates
4. **Scheduler duplicate deadline warnings** — the 5-minute warning window sent a message every minute; now sends only once per task using a `Set`
5. **`initSheets` Davomat header range** — used `A1:F1` (6 cols) for an 8-column header; fixed to `A1:H1`
6. **AI assistant Markdown errors** — AI responses with unescaped `_`, `*`, `` ` `` characters caused Telegram 400 errors; added plain-text fallback
7. **Location check-in Markdown crash** — reverse-geocoded addresses could contain Markdown special chars; now escaped before embedding in messages

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
