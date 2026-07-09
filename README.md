# Domain Radar

Domain Radar is a Replit-ready SaaS monitoring dashboard for checking whether domains are working, warning, or likely blocked across tenants, providers, rank-defense checks, and Telegram alerts.

## Current MVP

Domain Radar now includes:

- Email/password auth
- Merchant registration
- Forgot/reset password
- Demo login
- Superadmin role
- Tenant-scoped domains, projects, settings, provider nodes, and rank groups
- Tenant-aware scheduler
- Public landing page at `/landing.html`
- Merchant onboarding overlay
- Billing plans: Free, Starter, Pro
- Custom payment gateway adapter placeholder
- Manual/mock invoice flow for marketing/demo
- Plan quota enforcement
- Billing dashboard overlay
- Superadmin operations panel
- Merchant/invoice CSV exports

## Features

- Add single domain
- Bulk import domains
- DNS resolve check
- HTTP and HTTPS check
- Redirect and page signal detection
- Direct checker and provider-node checker
- PostgreSQL history
- Telegram status-change alerts
- Manual check button
- Scheduled monitor
- Google rank defense and suspicious SERP detection
- SaaS billing and quota guardrails

## Quick Start

```bash
npm install
npm run db:init
npm run dev
```

## Production / Replit Launch

See:

- [`DEPLOYMENT.md`](./DEPLOYMENT.md)
- [`QA_CHECKLIST.md`](./QA_CHECKLIST.md)
- [`LAUNCH_NOTES.md`](./LAUNCH_NOTES.md)
- [`.env.example`](./.env.example)

Quick republish path:

```bash
git pull origin main
npm install
npm run db:init
npm run build
npm start
```

## Required Replit Secrets

Minimum launch secrets:

```txt
DATABASE_URL
SESSION_SECRET
ADMIN_EMAIL
ADMIN_PASSWORD
DOMAIN_RADAR_DASHBOARD_URL
SMTP_HOST
SMTP_PORT
SMTP_USER
SMTP_PASS
SMTP_FROM
```

Optional but recommended:

```txt
TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID
SERPER_API_KEY
GOOGLE_SEARCH_API_KEY
GOOGLE_SEARCH_CX
PAYMENT_GATEWAY_NAME
PAYMENT_GATEWAY_RETURN_URL
```

For marketing/demo, keep `PAYMENT_GATEWAY_BASE_URL` empty. The billing adapter will create manual/mock invoices until the real custom payment gateway API is ready.

## Database

The base schema is in `server/db/schema.sql`.

To initialize the database:

```bash
npm run db:init
```

The server also performs safe table/column checks at boot for newer SaaS modules.

## Public URLs

- App/login/dashboard: `/`
- Landing page: `/landing.html`
- Register mode: `/?mode=register`
- Forgot password mode: `/?mode=forgot`

## Replit Import

1. Create a new Replit project.
2. Choose Import from GitHub.
3. Import this repo.
4. Add the required Secrets.
5. Run `npm install`.
6. Run `npm run db:init`.
7. Run `npm run build`.
8. Run or deploy with `npm start`.
