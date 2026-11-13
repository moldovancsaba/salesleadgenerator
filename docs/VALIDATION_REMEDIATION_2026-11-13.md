# Validation remediation — 13 November 2026, version 2.4.377

This release resolves the three integration failures and 16 style findings discovered while verifying 2.4.376. It changes test isolation and color ownership; it does not alter the live Vegas campaign, scanner configuration, access codes, mail routing, lead data or event behavior.

## Issue 338 — fallback brand expectations

The empty-registry tests in `tests/integration/brand.integration.test.ts` and `tests/integration/admin-clients.integration.test.ts` still asserted the original three clients. The source fallback registry already contains six: cogmap, dvsc, egm, racket-land, seyu and vegas.

The assertions and descriptions now cover those six. Tests for a populated Mongo registry remaining authoritative and client access control are retained. No production registry entries were changed.

## Issue 339 — webhook scenario isolation

The CC-copy scenario passes on its own. The earlier routed-reply scenario uses a synthetic representative address outside the known internal-company domains. Its real participant-harvesting path adds that address to the test lead. With the same database reused by the following test, the next email matches a lead contact as its sender and correctly takes the existing sender-first inbound path.

The cause is shared fixture state, not a demonstrated routing regression. The webhook suite now clears documents from its disposable MongoMemoryServer database in `beforeEach`. Collections and indexes remain intact, matching the application's cached index guards. The receiving API remains mocked at the network boundary. No production routing or contact-harvesting logic was changed, no actual mail was sent, and no production database was accessed.

All 23 webhook scenarios pass both in the full integration run and with `--sequence.shuffle --sequence.seed=340`.

## Issue 340 — style ownership and false positives

The 16 reported source files contain two kinds of findings:

- Actual literal colors in eight event modules (badge route, landing renderer, scanner, editor, Apple Wallet, canvas badge, confirmation mail and landing schema). Their existing values now live in `lib/theme/event-pass-colors.ts` and `lib/theme/landing-page-presets.ts`, under the existing theme ownership convention. Consumers import named constants. The five campaign presets remain re-exported as `THEME_PRESETS` for compatibility; the theme module imports its shape as a type only.
- Seven test descriptions such as `Issue #319`, where the basic color expression interprets the three digits after the hash as a hex color. Their titles now say `Issue 319`. The existing preset assertion also uses the named palette. These are source fixes, not audit exclusions.

The apostrophe entity in confirmation email escaping is now `&#39;` rather than `&#039;`: the equivalent decimal entity avoids the same scanner ambiguity. Apostrophes remain escaped.

Canvas, standalone SVG, email clients and Apple Wallet need concrete color values, so those consumers cannot depend on browser CSS custom properties. The shared palette has no client-only or server-only runtime dependency. No manifest exemptions, audit rule changes, dependency changes or suppressed findings were added. Existing hex/RGB spellings and opacity values are preserved.

### Rendering verification

A deterministic local before/after comparison against commit `ef91a94` verified:

- The five campaign preset objects are equal.
- The SVG badge output is byte-for-byte equal for a synthetic attendee containing XML-sensitive characters.
- Canvas drawing calls, color assignments and QR generation arguments are equal.
- Six Wallet brand selections (default, Vegas, Racket.land, legacy Padel Africa, Seyu and Cogmap) have equal theme results.
- The confirmation email request payload is equal after normalizing only the equivalent apostrophe entity. The mail SDK was replaced by an in-memory capture; there was no send/network action.

Browser verification of the local Vegas public page confirmed the full form, approved wording, input styling and default opt-out choice. The scanner unlock and station layouts were checked, including the local `verifyOnly` unlock path. Browser warning/error logs were empty for both pages. No registration or scan was submitted. Camera decoding, torch and wake lock were not retested on physical phones; the change only moves their existing style values.

## Checks

| Command | Result |
| --- | --- |
| `npx tsc --noEmit` | Pass, zero errors. |
| `npm run lint` | Pass, zero errors/warnings. |
| `npx vitest run` | 186 files, 1,887 tests passed. |
| `npm run test:integration` | 57 files, all 617 tests passed. |
| Webhook shuffled run | All 23 scenarios passed, seed 340. |
| `npm run test:smoke` | All 5 passed. |
| `npm run audit:gds-style` | Manifest and compliance both pass; zero findings. |
| `npm run build` | Production compilation, typecheck and generation pass. |
| `git diff --check` | Pass. |

The host's available Node/pnpm tooling was used as in 2.4.376; script commands needing npm ran through temporary `pnpm dlx npm@11`. No application dependency or lock resolution changed. The generated Next.js development-only addition to `AGENTS.md` was removed after stopping preview; project operating rules are unchanged.

## Rollback

Revert the 2.4.377 source commit as a unit, restoring the original color definitions/imports together and the previous test fixtures. No database migration or production configuration rollback is required. Stored Vegas copy and switches remain as saved on 13 November and are not overwritten by the deployment. Reverting restores the pre-existing validation failures, so retain this investigation record when doing so.
