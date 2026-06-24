# Domain Radar

Domain Radar is a Replit-ready monitoring dashboard for checking whether domains are working, warning, or likely blocked.

## Features

- Add single domain
- Bulk import domains
- DNS resolve check
- HTTP and HTTPS check
- Redirect and page signal detection
- Direct checker and provider checker
- PostgreSQL history
- Telegram status-change alert
- Manual check button
- Scheduled monitor

## Quick Start

```bash
npm install
npm run db:init
npm run dev
```

## Required Replit Secrets

```txt
DATABASE_URL
TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID
CHECK_INTERVAL_SECONDS
STATUS_KEYWORDS
```

## Database

The schema is in `server/db/schema.sql`.

To initialize the database:

```bash
npm run db:init
```

## Replit Import

1. Create a new Replit project.
2. Choose Import from GitHub.
3. Import this repo.
4. Add the required Secrets.
5. Run `npm install`.
6. Run `npm run db:init`.
7. Run `npm run dev`.
