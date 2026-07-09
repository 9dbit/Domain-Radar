# Domain Radar Launch QA Checklist

Use this checklist after pulling latest `main` and before republishing on Replit.

## A. Build and boot

- [ ] `npm install` completes without errors
- [ ] `npm run db:init` completes
- [ ] `npm run build` completes
- [ ] `npm start` boots server
- [ ] `/api/health` returns database connected
- [ ] `/` loads login/dashboard app
- [ ] `/landing.html` loads public landing page

## B. Auth

- [ ] Superadmin can login with `ADMIN_EMAIL` / `ADMIN_PASSWORD`
- [ ] Demo login works with `demo@domain-radar.org` / `DEMO_PASSWORD`
- [ ] Merchant registration works from `/?mode=register`
- [ ] Forgot password flow starts from `/?mode=forgot`
- [ ] Password reset email is sent or logged in dev fallback
- [ ] `/api/auth/me` returns `authenticated: true` after login
- [ ] Logout clears session

## C. Merchant onboarding

Test with a fresh merchant account.

- [ ] Onboarding overlay appears for new merchant with no domains
- [ ] Project creation works
- [ ] Domain creation works
- [ ] Optional Telegram settings save without breaking flow
- [ ] Skip button works
- [ ] Dashboard reloads after onboarding

## D. Domain monitoring

- [ ] Add single domain
- [ ] Bulk import domains
- [ ] Manual check all domains
- [ ] Manual check one domain
- [ ] Overview cards update
- [ ] Results table updates
- [ ] Alerts table updates when status changes
- [ ] CSV export domains works
- [ ] CSV export results works

## E. Tenant isolation

Use at least two merchant accounts.

- [ ] Merchant A cannot see Merchant B domains
- [ ] Merchant A cannot see Merchant B projects
- [ ] Merchant A cannot see Merchant B nodes except platform nodes
- [ ] Merchant A cannot see Merchant B rank groups
- [ ] Settings are saved per merchant
- [ ] Telegram alert routing uses merchant/project configuration

## F. Billing

- [ ] Billing button appears in sidebar/mobile menu
- [ ] Billing overlay opens
- [ ] Active plan displays
- [ ] Usage counters display
- [ ] Latest invoices display
- [ ] Starter upgrade creates invoice
- [ ] Pro upgrade creates invoice
- [ ] If payment gateway env is empty, invoice shows manual/mock instructions
- [ ] If invoice has payment URL, Open Payment works

## G. Quotas

Test with Free plan limits.

- [ ] Domain limit blocks extra single domain
- [ ] Bulk import cannot bypass domain limit
- [ ] Project limit blocks extra project
- [ ] Provider node limit blocks extra private node
- [ ] Provider preset import respects node quota
- [ ] Rank group limit blocks extra rank keyword group
- [ ] `PLAN_LIMIT_REACHED` toast appears
- [ ] Toast Open Billing button opens Billing overlay
- [ ] Superadmin bypasses quota

## H. Superadmin operations

Login as superadmin.

- [ ] Superadmin button appears
- [ ] Merchants list loads
- [ ] Merchant usage displays
- [ ] Merchant detail opens
- [ ] Manual plan change works
- [ ] Manual invoice confirmation works
- [ ] Suspend merchant works
- [ ] Suspended merchant cannot login
- [ ] Unsuspend merchant works
- [ ] Send Reset action works
- [ ] Export Merchants CSV works
- [ ] Export Invoices CSV works

## I. Scheduler and alerts

- [ ] Scheduler starts after server boot
- [ ] Manual check still works while scheduler is running
- [ ] Tenant check interval respected
- [ ] Tenant Telegram alert works
- [ ] Project Telegram mapping works when configured
- [ ] No Telegram alert is sent to wrong tenant

## J. Rank defense

- [ ] Add rank keyword group
- [ ] Add whitelisted domain to keyword group
- [ ] Manual check keyword group
- [ ] Check all keyword groups
- [ ] Rank results show classification
- [ ] Suspicious results create alert when threshold matches

## K. Replit republish

- [ ] Pull latest `main`
- [ ] Ensure Secrets are set
- [ ] Run `npm install`
- [ ] Run `npm run db:init`
- [ ] Run `npm run build`
- [ ] Republish / redeploy
- [ ] Open public URL
- [ ] Test login and `/api/health`
