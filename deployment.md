# Deployment Log

## Latest Deployment
- **Commit**: cf88474
- **Message**: fix: allow null lead prop in LeadDetailModal to resolve build type error
- **Pushed**: 2026-07-22 14:55:42 UTC
- **Vercel Build**: Started 2026-07-22 16:40:28 UTC (iad1)
- **Build Status**: Failed initially with TS error `page.tsx:208` (`Lead | null` not assignable to `Lead`), fixed in cf88474
- **Files Changed**:
  - `app/sales/[brand]/page.tsx`
  - `app/detail.tsx`
  - `app/lib/normalize-lead.ts`
  - `app/card.tsx`

## Previous Deployments
- 545b57e — fix: wire modal opening reliably and stop defaulting unknown region to US
- af833d2 — fix: harden PWA preview path and remove zoom-forcing viewport
- 05ec8ac — refactor: zero-client-calc UI, board metadata API, lazy columns, metrics endpoint
- 507d281 — fix: resolve build errors in api settings/forecast and metrics missing imports
