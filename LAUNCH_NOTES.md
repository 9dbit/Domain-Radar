# Domain Radar Launch Notes

## Current status

Domain Radar has been converted from a single-admin monitoring tool into a SaaS-ready MVP.

## Completed SaaS modules

### Auth

- Email/password login
- Register
- Email verification token support
- Forgot password
- Reset password
- Demo login
- Legacy admin password compatibility
- Superadmin role
- Merchant role
- Demo role
- Suspended account handling

### Multi-tenant core

- Domains scoped by user
- Projects scoped by user
- Settings scoped by user
- Provider nodes support platform-shared and merchant-private nodes
- Rank defense scoped by user
- Project Telegram mappings scoped by user
- Scheduler uses tenant settings and tenant-visible nodes

### Public and onboarding

- Public landing page at `/landing.html`
- Landing CTA to register mode
- Progressive onboarding overlay for new merchants
- First project/domain creation from onboarding
- Optional Telegram setup during onboarding

### Billing

- Free / Starter / Pro plan definitions
- Subscription table
- Billing invoice table
- Billing event log
- Custom payment gateway adapter placeholder
- Manual/mock invoice mode for marketing/demo
- Billing overlay in dashboard
- Upgrade buttons for Starter/Pro
- Invoice list and payment instructions

### Quotas

- Single domain quota
- Bulk domain quota
- Project quota
- Provider node quota
- Provider preset quota
- Rank group quota
- `PLAN_LIMIT_REACHED` UI toast
- Superadmin quota bypass

### Superadmin operations

- Superadmin-only `/api/admin` routes
- Merchant list
- Merchant detail
- Plan changes
- Manual invoice confirmation
- Suspend/unsuspend merchant
- Password reset action
- Metrics overview
- Merchants CSV export
- Invoices CSV export

## Replit republish quick path

```bash
git pull origin main
npm install
npm run db:init
npm run build
npm start
```

Then republish/redeploy from Replit.

## Launch-safe payment behavior

The app does not attempt to charge real money until the custom gateway adapter is wired.

If `PAYMENT_GATEWAY_BASE_URL` is blank, invoice creation returns manual/mock payment instructions. This is intentional and safe for marketing/demo.

## Remaining future enhancements

These are not MVP blockers:

- Real custom payment gateway HTTP integration
- Webhook signature mapping for the final gateway
- Read-only merchant impersonation
- Make `/landing.html` the default unauthenticated `/` route
- Provider node partial unique-index hardening for platform nodes
- Fully native React admin page instead of progressive overlay
- Automated test suite

## Manual branch cleanup

The GitHub connector used during development cannot delete branches. After republish is verified, delete merged branches manually from GitHub UI if desired.

Suggested merged branches to remove:

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
