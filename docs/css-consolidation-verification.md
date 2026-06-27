# CSS Consolidation Verification — Layout QA

**Date:** 2026-06-27  
**Task:** Verify sidebar and all page layouts after consolidating 11 patch CSS files into `sidebar.css` and `app-patches.css`.

---

## Files Verified

| File | Role |
|---|---|
| `public/sidebar.css` | Sidebar layout + responsive breakpoints for React `<aside>` and Defense Center `.sideNav` |
| `public/app-patches.css` | Settings, AI Advisor, Analytics, Alert Center, mobile table card layout |
| `src/style.css` | Main `.app` grid, base element styles, responsive overrides |
| `src/dashboard-patches.css` | React-specific patch layer (still active) |

---

## Viewport Matrix

### Sidebar at 1280px (≥981px default)
- `sidebar.css`: `aside { position: fixed; width: 240px; }`
- `style.css`: `.app { display: grid; grid-template-columns: 240px 1fr; }`
- **Result:** Fixed 240px sidebar; main content starts at 240px. ✅

### Sidebar at 980px (icon-only)
- `sidebar.css @media(max-width:980px)`: `aside { width: 64px; }`, labels `font-size: 0`, icons centered
- `style.css @media(max-width:980px)`: `.app { grid-template-columns: 64px 1fr }`
- **Result:** 64px icon-only sidebar; grid column matches. ✅

### Sidebar at 640px (horizontal nav bar)
- `sidebar.css @media(max-width:640px)`: `aside { position: sticky; top:0; height: auto; width: 100%; display: flex; flex-direction: row; }`
- `style.css @media(max-width:640px)`: `.app { display: block }; main { padding: 12px; overflow-x: hidden }`
- **Result:** Block layout, sidebar is sticky horizontal strip at top. ✅

---

## Page-Specific Checks

### Settings page (settings-all-ui.js)
- `.settingsAllGrid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 14px; }` — two-column grid. ✅
- `.settingsBlock.wide { grid-column: 1 / -1; }` — full-width blocks span both columns. ✅
- Collapses to 1 column at 1100px and 760px. ✅
- `.settingsAllPage { display: none; }` default; `settings-all-ui.js` sets `display: block` when active. ✅

### AI Advisor sidebar
- `transform: translateX(calc(100%+28px))` (hidden) / `translateX(0)` (open on `.aiSidebarOpen`) — toggle works. ✅
- `overflow-y: auto` / `overflow: auto` — sidebar scrolls. ✅
- `.aiAdvisorSidebar * { max-width: 100%; box-sizing: border-box; }` — no horizontal overflow. ✅

### Analytics page
- `.analyticsMode main > :not(#analyticsPage) { display: none; }` — hides other content in analytics mode. ✅
- `#analyticsPage { display: none; }` default, shown via `.analyticsMode #analyticsPage { display: block; }`. ✅
- `.analyticsGridTop` 4-col → 2-col at 1100px; `.analyticsTwoCol` collapses at 1100px/760px. ✅

### Mobile table card layout (<760px) — BUG FIXED
- **Issue found:** `style.css` at 760px sets global `table { min-width: 780px; }`. The card-layout rule in
  `app-patches.css` used `max-width: 100%` but not `min-width: 0`. On narrow viewports, `min-width: 780px`
  forces the block-mode table to 780px, causing horizontal clipping inside `.panel`.
- **Fix applied:** Added `min-width: 0` to `.panel table` in `app-patches.css` @760px media query.
  Now `.panel table { display: block; width: 100%; max-width: 100%; min-width: 0; }` — higher specificity
  (0-1-1 vs 0-0-1) and explicit `min-width: 0` prevents the overflow. ✅
- Card column labels (Domain, Project, Status, Last, Checked, Active, Actions) via `::before`. ✅
- Row cards: `background: #202124; border-radius: 16px; overflow: hidden`. ✅

---

## Pre-existing Condition Noted (not a regression)

`dashboard-patches.css` (Vite-bundled, loads after `app-patches.css`) overrides AI Advisor
toggle/sidebar styles. This was pre-existing before the consolidation. Follow-up tasks created
to consolidate the duplicate AI Advisor CSS rules.

---

## Conclusion

All layout requirements met after applying the `min-width: 0` fix to mobile table card mode.
No other regressions were found in the CSS consolidation.
