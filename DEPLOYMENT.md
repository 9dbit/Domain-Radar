# Domain Radar Deployment Guide

This guide is for launching the current SaaS MVP on Replit or a similar Node/PostgreSQL host.

## 1. Pull latest code

In Replit Shell:

```bash
git pull origin main
npm install
```

## 2. Configure Secrets

Add the values from `.env.example` into Replit Secrets.

Minimum production secrets:

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

For marketing/demo, `PAYMENT_GATEWAY_BASE_URL` can stay empty. The billing adapter will create manual/mock invoices until the real payment gateway API is ready.

## 3. Initialize database

Run once after setting `DATABASE_URL`:

```bash
npm run db:init
```

The server also performs safe `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ADD COLUMN IF NOT EXISTS` checks for newer SaaS tables at boot.

## 4. Build frontend

```bash
npm run build
```

## 5. Start production server

```bash
npm start
```

Replit deployment should use:

```bash
npm start
```

The server serves built assets from `dist` when available.

## 6. First superadmin login

Set:

```txt
ADMIN_EMAIL=your-admin@example.com
ADMIN_PASSWORD=your-strong-password
```

Then login with that email/password. Legacy admin-password login is also preserved for compatibility.

## 7. Marketing URLs

- Main app/login/dashboard: `/`
- Public landing page: `/landing.html`
- Register mode: `/?mode=register`
- Forgot password mode: `/?mode=forgot`

## 8. SaaS features now available

- Email/password auth
- Register / login / forgot password / reset password
- Demo login
- Tenant-scoped domains, projects, settings, nodes, rank groups
- Tenant-aware scheduler
- Tenant Telegram alerts
- Public landing page
- Merchant onboarding overlay
- Billing overlay
- Custom payment gateway placeholder
- Plan quota enforcement
- Superadmin operations panel
- Merchant and invoice CSV exports

## 9. Payment gateway integration later

When the custom gateway API is ready, update `server/billingGateway.js`:

- Implement real HTTP create-invoice call inside `createInvoice()`
- Verify webhook signature in `verifyCallback()`
- Map webhook payload fields in `normalizeEvent()`

Keep these env values ready:

```txt
PAYMENT_GATEWAY_NAME
PAYMENT_GATEWAY_BASE_URL
PAYMENT_GATEWAY_API_KEY
PAYMENT_GATEWAY_SECRET
PAYMENT_GATEWAY_CALLBACK_SECRET
PAYMENT_GATEWAY_RETURN_URL
```

## 10. Branch cleanup

After deployment is confirmed, merged feature branches can be deleted manually in GitHub UI.

Suggested branches to delete:

```txt
saas-auth-foundation
tenant-scope-routes
scheduler-tenant-routing
frontend-auth-pages
public-landing-page
onboarding-wizard
saas-flow-polish
custom-billing-infra
billing-ui-foundation
quota-completion
superadmin-billing-ops
admin-ops-polish
launch-readiness-docs
```
