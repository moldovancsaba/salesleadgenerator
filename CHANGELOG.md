# Changelog — Sales Lead Generator

## 2.4.19

### Added — brand-specific browser tab titles
- Owner asked for CogMap's and Seyu's pages to have distinguishable browser tab titles, to tell them apart when both are open in separate tabs. `/sales/[brand]/page.tsx` now exports `generateMetadata()`, returning just the brand's display label (`CogMap`/`Seyu`, from the existing `BRAND_CONFIG`/`resolveBrand()` in `app/lib/brand.ts` — no new brand-name mapping introduced). The root layout's `metadata.title` was changed from a plain string to a `{ template, default }` object (`"%s · Sales Lead Generator"` / `"Sales Lead Generator"`), Next.js's standard mechanism for per-route title composition — child pages set just their own piece, the root supplies the shared suffix.
- Brand name comes first in the tab title (`CogMap · Sales Lead Generator`, `Seyu · Sales Lead Generator`) rather than last, since browser tabs truncate long titles from the end — the distinguishing part needs to be visible first to actually help scanning between tabs.
- Verified with the real rendered `<title>` tag from a running dev server (`curl` against `/sales/cogmap`, `/sales/seyu`, and `/`), not just inferred from the code — confirmed `CogMap · Sales Lead Generator`, `Seyu · Sales Lead Generator`, and the unchanged `Sales Lead Generator` default respectively. Only `/sales/[brand]` was touched; the public landing page (`/`), `/forecast`, and `/outreach/templates` keep the default title (out of scope — the request was specifically about the client/brand pages).

## 2.4.18

Real-device confirmation from the owner on production (mobile, portrait): PWA works, the lead detail modal works, the double-bordered kanban cards are fixed, and the iOS zoom-on-focus problem is fixed. This closes out every open item from the 2.4.17 fix that this sandbox couldn't verify itself (no local GDS rendering, no live-URL access, no real device). Drag-and-drop is confirmed off (as intended — `enableDrag` was deliberately disabled in 2.4.17); owner is fine leaving it off rather than re-enabling it.

### Confirmed working (real device, production)
- ✅ Double-bordered kanban cards — fixed. `LeadCard`'s flat, borderless rewrite (2.4.17) resolved the nested-`Paper` visual issue as intended.
- ✅ "Client-side exception" crash — no longer occurring. Disabling `enableDrag` (2.4.17) is now a confirmed fix, not just a reasoned hypothesis; the real `@dnd-kit` code path was the actual cause.
- ✅ iOS zoom-on-focus — fixed. GDS's theme-level `Input.vars` mechanism (adopted 2.4.10) genuinely floors every affected input's font-size on a real device, not just in this sandbox's Chromium-based emulation (which can't reproduce WebKit's actual zoom heuristic).
- ✅ PWA installability — works. Closes the "owner reports it's still not behaving as expected" open item that had been outstanding since 2.2.1/2026-07-23.
- ✅ Mobile portrait: drag-and-drop is off, as expected (matching the 2.4.17 rollback) — owner has explicitly accepted this trade-off rather than asking for `enableDrag` to be re-enabled.

## 2.4.17

Owner reported (screenshot) every kanban card showing a visible "box within a box," plus a drag-handle icon and a second icon flanking each card — on top of an unrelated "client-side exception" crash report on the live production URL. Root-caused the visual issue precisely via GDS's real source; treated the crash as a strong signal to roll back the one genuinely new, never-before-executed-in-production code path from this whole GDS 3.11.x bump.

### Fixed — double-bordered kanban cards
- Confirmed via GDS's real source (`packages/gds-core/src/KanbanBoard.client.tsx`, `ProductCard.tsx` at `gds-v3.11.1`): `KanbanCard` always wraps whatever `renderItem` returns inside its own `Paper withBorder radius="md" p="sm"` shell (alongside the drag-handle and Move-menu icons), and `ProductCard` *always* renders with `withBorder` too — no variant removes it. `app/card.tsx`'s `LeadCard` was rendering `ProductCard` (its own bordered shell) *inside* `KanbanCard`'s already-bordered shell, producing exactly the nested-box look in the screenshot.
- Rewrote `LeadCard` to render flat, borderless content (plain `Stack`/`Group`/`Text`/`Badge`/`Button`, no `ProductCard`) — GDS's own `KanbanCard` `Paper` is now the only visible border around each card. `LeadCard` is only ever used inside the kanban board's `renderItem`, so this has no other call sites to consider.

### Rolled back — kanban `enableDrag`
- Turned off `enableDrag` on `GdsKanbanBoard` (was on since 2.4.10). This removes the per-card drag-handle icon — one of the "boxes" in the screenshot — and, more importantly, deactivates the one genuinely new runtime code path in this entire GDS 3.11.x bump: real `@dnd-kit` `DndContext`/sensors, which had never actually executed in a successful production build before a "client-side exception" was reported live (every prior build attempt failed before this code path could even run). The keyboard/tap-accessible "Move to column" menu is unconditional (not gated by `enableDrag`) and still provides full move functionality without it.
- **Disclosed limitation**: I could not reproduce or visually confirm either fix locally. GDS packages are hand-written `any`-typed stubs in this sandbox that render `null` — the kanban board area is blank in a local dev server, so neither the double-border nor the drag-handle removal can be screenshotted here. I also could not reach the live production URL directly (`vercel.app` is blocked by this sandbox's network policy, the same as `github.com`) to confirm the crash's actual stack trace. Confidence in the double-border fix rests on GDS's real, fetched source; confidence that disabling `enableDrag` addresses the crash is a reasoned hypothesis (the only genuinely new, never-proven-in-production code path), not a confirmed root cause — real-device/production confirmation is still needed.

## 2.4.16

Owner asked for a proactive sweep for similar errors, rather than waiting for a fifth Vercel build to find the next one.

### Audited every GDS import in the codebase against real 3.11.1 source
- Grepped for all `@sovereignsquad/*` imports across the entire repo (not just the files already touched this incident) — found 8 usages across `app/detail.tsx`, `app/search-learning.tsx`, `app/page.tsx`, `app/kanban.tsx`, `app/metrics.tsx`, `app/card.tsx`, `app/layout.tsx`, `app/table.tsx`.
- Fetched and checked the real prop contracts for every one not already fixed this incident: `AdminModal`, `AdminDetailDrawer` (props match, `onClose`'s narrower arity is safely assignable), `AdminTextarea` (unchanged, already checked), `InfoCard` (plain string/number props, no function-typed props, no risk), `ProductCard` (`metadata`/`title`/`description`/`status`/`primaryAction` all match), `AdminDataTable` (generic over `T`, so `rows`/`getRowKey`/`renderMobileCard` correctly parametrize against this app's own row type — structurally immune to the same contravariance issue that broke `KanbanBoard`, since `KanbanBoard`'s `KanbanItem`/`KanbanColumnData` are fixed, non-generic interfaces).

### Found and fixed one more real gap: `AdminResourceCard`
- `app/search-learning.tsx`'s "Top Queries" card passed its `record` prop with an explicit `as any` cast — found by grepping for `as any` across `app/`. Fetched `AdminResourceCard`'s real prop type (`AdminResourceCardProps<T extends AdminResourceRecord>`, generic like `AdminDataTable`) and its `AdminResourceRecord` shape (`id: string; title: ReactNode;` required, everything else optional) — the object literal already being passed (`{id, title, description, status}`) satisfies this exactly, no cast needed. Removed the unnecessary `as any`, confirmed clean via `tsc --noEmit` without it. This wasn't causing a runtime bug, but the cast fully suppressed type-checking for this call site — exactly the kind of silent gap that let the other four bugs in this incident ship undetected, now closed before it caused a fifth.
- Upgraded the local stub (`node_modules/@sovereignsquad/gds-admin/client/index.d.ts`, gitignored) with `AdminResourceCard`'s real, verified prop type and the `AdminResourceRecord` interface, alongside the `AdminSelect` type already added in 2.4.14.

### Other `as any` casts checked and left alone
Grepped every `as any` in `app/` — the remaining ones (`app/detail.tsx`'s dynamic `PRO_FIELD`/`CON_FIELD` lookups, `app/api/search-learning/route.ts`'s MongoDB `$each`/`$slice` update operators, `app/api/leads/route.ts`'s action-string cast, `app/lib/lead-actions.ts`'s `findOneAndUpdate` result shape) are unrelated to any GDS package's type contract — internal dynamic-field access and known MongoDB-driver typing quirks, not an unverified assumption about an external package. Left as-is.

## 2.4.15

**A fourth real failure from the same GDS bump** — `app/kanban.tsx:235` — `Type '(item: LeadKanbanItem, column: LeadKanbanColumn) => JSX.Element' is not assignable to type '(item: KanbanItem, column: KanbanColumnData) => ReactNode'. Property 'lead' is missing in type 'KanbanItem' but required in type 'LeadKanbanItem'.`

### Root cause
`KanbanBoard`'s real `KanbanItem`/`KanbanColumnData` interfaces are fixed, non-generic shapes (`{ id, title, description?, status?, ariaLabel? }` / `{ id, title, items }`) — they carry no `lead` field, since GDS has no idea what domain data a consumer attaches. This app's `renderItem` callback was typed to require its own richer `LeadKanbanItem`/`LeadKanbanColumn` (which do carry `lead: Lead`, since that's what's actually constructed at runtime) as its parameters. TypeScript checks a function prop's parameter types contravariantly: `KanbanBoard` will call `renderItem` with a plain `KanbanItem`, so a `renderItem` that *requires* a `LeadKanbanItem` is unsound and correctly rejected — real `gds-core` types enforce this; this sandbox's local stub (`KanbanBoard: any`) didn't, so it went undetected until the fourth real Vercel build in this bump cycle.

### Fixed
- `app/kanban.tsx`'s `renderItem` now takes `(item: GdsKanbanItem, column: GdsKanbanColumnData)` — the real, base contract — and casts internally (`const leadItem = item as LeadKanbanItem`) to reach `.lead`, which the constructed objects genuinely carry at runtime (the same pattern already used elsewhere in this file for `column.id as KanbanColumn`).
- **Upgraded the local stub for real this time**: `node_modules/@sovereignsquad/gds-core/client/index.d.ts` (gitignored) now declares the real `KanbanItem`/`KanbanColumnData`/`KanbanOrientation`/`OnMoveItem` types and a properly-typed `KanbanBoard` component, transcribed from `packages/gds-core/src/KanbanBoard.client.tsx` at `gds-v3.11.1` (read in full earlier this session, not re-guessed). Confirmed effective the same way as 2.4.14's `AdminSelect` fix: reverted the code change, re-ran `tsc --noEmit`, watched it correctly re-flag the exact same error, then restored the fix and confirmed clean.
- `KanbanColumn`/`KanbanCard` (GDS's own sub-components, not directly used by this app) remain `any`-typed; `useGdsKanbanOrientation` now has a real return type.

### Pattern across four consecutive deployments (2.4.12–2.4.15)
One GDS version bump has now surfaced four distinct real production failures — a 404 tarball, a missing transitive dependency, and two genuine type-contract mismatches — each only catchable by an actual `npm install` + `tsc` run against the real, compiled package. This sandbox cannot run that end-to-end for the privately-tarball-installed GDS packages, so every "verified" claim this session made had an inherent gap. Rather than re-discover it a fifth time, the two GDS components this app actually imports (`AdminSelect`, `KanbanBoard`) now carry real, verified local stub types instead of `any` — closing the gap for exactly the surface area this app touches, though anything else imported from GDS in the future will need the same treatment before it can be trusted locally.

## 2.4.14

**2.4.13's `@dnd-kit` fix let `npm install` and webpack module resolution succeed, but a third real failure surfaced** — a genuine TypeScript type error: `app/detail.tsx:358` — `AdminSelect`'s `onChange` prop is typed `(value: string | null) => void` (matching Mantine's own `Select`, which can emit `null` on a cleared/no-match selection), but the app's handler was typed `(value: string) => void`.

### Root cause
This mismatch was invisible to every local check all along: this sandbox's local `@sovereignsquad/gds-admin` is a hand-written `any`-typed stub (the real package can't be installed here at all), so `tsc --noEmit` and `next build` locally never actually type-checked this call against the real `AdminSelect` prop contract — only against `any`, which accepts anything. This was the first time this exact code path was type-checked against the real, compiled package, because it's the first time `npm install` actually succeeded end-to-end in production this bump cycle.

### Fixed
- `app/detail.tsx`: `onChange={(value: string) => setDeclineReason(value as DeclineReason)}` → `onChange={(value: string | null) => value && setDeclineReason(value as DeclineReason)}` — matches the real contract, ignores a `null` (cleared) selection rather than crashing type-wise (this field isn't rendered as clearable, so `null` shouldn't fire in practice, but the type must still account for it).
- Confirmed the real `onChange` signature by fetching `packages/gds-admin/src/AdminForms.tsx` from the `gds-v3.11.1` tag directly — not guessed. `AdminTextarea`'s signature (`(value: string) => void`, no `null`) was checked too and is unchanged; no other call site in this file needed a change.
- **Closed part of the underlying gap**: `node_modules/@sovereignsquad/gds-admin/client/index.d.ts` (the local sandbox stub) now types `AdminSelect` with its real, verified prop signature instead of `any` — confirmed by reverting the code fix and re-running `tsc`, which now correctly re-flags the exact same error locally. `AdminModal`/`AdminDetailDrawer`/`InfoCard`/`AdminResourceCard`/`AdminDataTable` remain `any`-typed for now (not exhaustively re-typed in this pass) — their usages in this codebase are basic modal-shell props (booleans, strings, `ReactNode` children) at comparatively low risk, but the same class of drift is still possible there and wouldn't be caught locally.

### Disclosed pattern across 2.4.12/2.4.13/2.4.14
Three real, different production failures surfaced back-to-back from one GDS version bump, each only catchable by an actual successful `npm install` against the real package — something this sandbox cannot do at all for the private GDS tarballs. Every local "verified" claim this session has had an asterisk: it proves the code compiles against stub types, never that the real compiled package's actual contract matches. That asterisk is now made explicit in-repo (this entry, plus the improved `AdminSelect` stub type) rather than re-discovered the hard way a fourth time.

## 2.4.13

**2.4.12 fixed the tarball-404 problem but introduced a different real build failure** — Vercel's `npm install` succeeded this time (confirming the 3.11.1 tarball verification was correct), but `next build` then failed: `Module not found: Can't resolve '@dnd-kit/core'` (and `@dnd-kit/sortable`, `@dnd-kit/utilities`), imported from `@sovereignsquad/gds-core`'s compiled bundle via `app/kanban.tsx`.

### Root cause
`@sovereignsquad/gds-core@3.11.1`'s own `package.json` declares `@dnd-kit/core`/`sortable`/`utilities` as regular `dependencies` (confirmed by fetching `packages/gds-core/package.json` from the `gds-v3.11.1` tag) — they should install transitively. They didn't, because this repo's committed `package-lock.json` has been out of sync with the real dependency tree for a long time: it tracks only ~220 packages system-wide, independent of anything this session touched (confirmed identical at commit `138aca0`, well before any GDS work this session did). Vercel's `npm install` (not `npm ci` — a hard lockfile/package.json mismatch would have failed immediately rather than installing and only failing later at the webpack stage) mostly trusts a restored build-cache `node_modules` plus the checked-in lockfile rather than fully re-resolving from scratch, so the newly-required `@dnd-kit/*` transitive subtree of the *tarball-installed* `gds-core` package was never discovered or added.

### Fixed
- Declared `@dnd-kit/core@^6.3.1`, `@dnd-kit/sortable@^10.0.0`, `@dnd-kit/utilities@^3.2.2` as direct dependencies in `package.json` — matching the exact versions `gds-core`'s own `package.json` requires — so they're unambiguously present regardless of any lockfile-caching behavior around the private, tarball-installed GDS packages.
- Added via a **real `npm install`** against the actual public `registry.npmjs.org` (confirmed reachable from this sandbox, unlike `github.com`/`api.github.com`) — not hand-edited. This pulled in the real resolved URLs and `integrity` hashes for `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`, and their own transitive dependency (`@dnd-kit/accessibility`, `tslib`), verified for real by npm itself rather than computed by hand.
- As a side effect, this same real `npm install` also expanded the previously-out-of-sync `package-lock.json` from ~220 to ~530 tracked packages, bringing it in line with the actual dependency tree for the first time — a pre-existing gap unrelated to this session's GDS work, now incidentally closed. 5 stale/platform-specific entries were dropped in the process (a Windows-only optional binary, a few unused transitive packages) — confirmed via diff, nothing the app uses.
- All 3 `@sovereignsquad/gds-*` entries (versions, `resolved` URLs, `integrity` hashes verified in 2.4.12) were preserved untouched by this `npm install` — confirmed via diff before and after.

### Disclosed limitation — still not fully verifiable from this sandbox
This sandbox's local `@sovereignsquad/gds-*` packages remain hand-written `any`-typed stubs (the real tarballs still can't be installed here — `github.com` release-asset downloads are blocked). That means the specific failure class this fix addresses — Next.js's webpack bundler resolving `@dnd-kit/*` imports from *inside the real, compiled `gds-core` dist bundle* — cannot be reproduced or re-verified locally: the stub `gds-core` has no `dist/` bundle at all, so `next build` succeeds locally whether or not `@dnd-kit/*` are present, the same as before this fix. Confidence in this fix rests on: (a) directly reading `gds-core@3.11.1`'s real `package.json` `dependencies` field, and (b) the exact 3 missing-module names Vercel's own build log reported, both matched precisely by what was added — not on a local build passing, which it always would have regardless.

## 2.4.12

Owner reported GDS 3.11.1 fixes the 2.4.10/2.4.11 tarball incident. Verified independently before touching anything — the last incident happened specifically because a claim ("the tag exists") was treated as equivalent to a different, unverified claim ("the tarball is fetchable"), so this time the tarball itself was actually fetched and inspected, not inferred.

### Verified before shipping (unlike 2.4.10)
- This sandbox's `curl`/`Bash` network path still 403s `github.com` unconditionally (confirmed identically for both 3.10.0's known-good URL and 3.11.1's — that path genuinely cannot distinguish real from missing). The `WebFetch` tool, however, resolves through a different network path that isn't blocked: it followed each of the 3 `gds-v3.11.1` release-asset URLs through GitHub's real `302` redirect to a signed `release-assets.githubusercontent.com` blob URL (a redirect GitHub only issues for an asset that actually exists) and retrieved the actual tarball bytes.
- All 3 tarballs (`gds-admin`, `gds-core`, `gds-theme`) were downloaded, confirmed as real gzip archives via `file`, extracted, and their `package/package.json` read directly — each correctly reports `"version": "3.11.1"` and the expected package name.
- The real SHA-512 of each tarball was computed twice, independently (`openssl dgst`/`base64` and Node's `crypto.createHash`), with matching results both times — these are the actual `integrity` values now in `package-lock.json`, not guessed or fabricated.
- Fetched `gds-v3.11.1`'s own `CHANGELOG.md`: it confirms the exact root cause independently — the `3.11.0` tag was cut before a same-day fix to the GDS repo's own release-automation workflow (`auto-tag-release.yml` was hitting `GITHUB_TOKEN` anti-recursion protection, blocking the tarball-publish job), so the tag existed but its release bundle never actually built. `3.11.1` is a pure re-cut with the pipeline fixed — "no functional/code change beyond the version-bump surfaces themselves," per the GDS team's own changelog wording.

### Changed
- `@sovereignsquad/gds-admin`/`gds-core`/`gds-theme` bumped 3.10.0 -> 3.11.1 in `package.json` and `package-lock.json`, with real, independently-verified `integrity` hashes (see above) — not the missing-then-guessed pattern from 2.4.10/2.4.11.
- No application code changes: since 3.11.1 is confirmed functionally identical to what 3.11.0 was supposed to be, the 2.4.10 code (theme-level `Input.vars` zoom fix, GDS-governed `KanbanBoard` with `enableDrag`) needs no changes and gets the newer pointer/touch drag behavior it was originally written for.
- Verified via `tsc --noEmit` (0 errors), `eslint` (0 errors, 3 pre-existing warnings carried forward), `vitest run` (35/35), smoke suite (5/5), and a real `next build`. As always, these still only prove the *code* against local stub packages — they cannot substitute for Vercel's own `npm install` succeeding, which is the actual test this fix is aimed at. That remaining gap is real and is why the tarball-fetch verification above was done as an extra, independent check this time, not skipped.

## 2.4.11

**Production build was broken on `main` for the entire window between 2.4.10 shipping and this fix.** Vercel's `npm install` failed with a real `404 Not Found` on `https://github.com/sovereignsquad/general-design-system/releases/download/gds-v3.11.0/sovereignsquad-gds-theme-3.11.0.tgz` — the 3.11.0 release tarball does not actually exist (or at least not at that URL), even though the `gds-v3.11.0` git tag and its `CHANGELOG.md` are real and readable.

### Root cause — a verification gap, not a typo
2.4.10 bumped the GDS dependency URLs to 3.11.0 based on: (a) the `gds-v3.11.0` git tag existing and being readable via `raw.githubusercontent.com` (this sandbox's only unblocked path to the GDS repo), and (b) that tag's own `CHANGELOG.md` describing an "automatic release-bundle workflow" that attaches tarballs on release. Neither of those actually confirms a GitHub Release with attached binary assets was published — a git tag and a GitHub Release are different objects, and the sandbox's `github.com`/`api.github.com` block (a permanent 403 regardless of whether the target resource is real) meant the tarball URL itself was never actually checked, only assumed to be "the same known sandbox block" as always. It wasn't — Vercel's real network access hit a genuine 404. Locally, `next build` succeeded against this app's own hand-written `any`-typed stub packages under `node_modules/@sovereignsquad/*` (necessary since the real packages can't be installed in this sandbox at all) — that verifies the *code* compiles and runs, never that `npm install` can actually fetch the real dependency. That gap was not disclosed clearly enough before shipping.

### Fixed
- Reverted `@sovereignsquad/gds-admin`/`gds-core`/`gds-theme` in `package.json` and `package-lock.json` back to 3.10.0 — the exact URLs, versions, and `integrity` hashes restored byte-for-byte from the last commit (`138aca0`) known to have deployed successfully, not re-derived or guessed.
- All 2.4.10 code changes (GDS theme-level `Input.vars` zoom fix via `app/components/Providers.tsx`, GDS-governed `KanbanBoard` in `app/kanban.tsx`) are kept as-is — none of them depend on a 3.11.0-only export. `KanbanBoard` itself (including the keyboard "Move to column" menu) is already present in 3.10.0's `gds-core`; only the newer `enableDrag` pointer/touch drag behavior described in the 3.11.0 changelog is unavailable until a real 3.11.0 release is confirmed to exist — passing `enableDrag` to a 3.10.0 `KanbanBoard` that doesn't recognize the prop is a no-op, not a crash (the accessible move-menu fallback still works either way).
- Version bumped 2.4.10 -> 2.4.11.

### Still open
- Whether GDS 3.11.0 will ever actually be published as a real, fetchable release is now an open question for the GDS team, not something to re-attempt from this sandbox — this sandbox has no way to distinguish "blocked" from "doesn't exist" for `github.com`/`api.github.com`, which is exactly what caused this incident. Any future GDS version bump needs confirmation from outside this sandbox (e.g., the owner or CI fetching the tarball URL directly) before it ships, not an inference from the git tag alone.

## 2.4.10

Owner reported GDS 3.11.0 shipped, built to this app's own earlier requests, and asked us to adopt its new Kanban pattern and zoom-to-focus fix.

### Changed — adopted GDS 3.11.0
- **Mobile input-focus auto-zoom guard moved to the theme level.** GDS 3.11.0's `gdsTheme` (`packages/gds-theme/src/theme.ts`) now floors every Mantine `Input`-based control's font-size to >=16px at `xs`/`sm`/default sizes via `components.Input.vars`, setting the same `--input-fz` CSS custom property Mantine's own size resolver reads — winning with no specificity contest and no `!important`. Extracted just this one component-override (not GDS's full theme, which also sets colors/Card/Button/Table defaults we don't want) into this app's own `createTheme()` call. The `!important` on `app/globals.css`'s bare `input, select, textarea { font-size: 16px }` rule (added in 2.4.6 specifically because a bare selector couldn't out-rank Mantine's class selector) is no longer needed and was removed; the rule itself stays as a documented no-op safety net for any hypothetical raw native input outside Mantine's control (there are none in this app today — confirmed via grep).
- **`app/kanban.tsx` rewritten to use GDS's governed `KanbanBoard`** (`@sovereignsquad/gds-core/client`, new in 3.10.0, gaining accessible drag-and-drop in 3.11.0 via an opt-in `enableDrag` prop), replacing this app's own hand-rolled pointer-events drag-and-drop (200ms long-press-arm, manual ghost `Box`, `document.elementFromPoint` column lookup). GDS's version is built on `@dnd-kit` (fully encapsulated inside `gds-core`, never a consumer import) with `PointerSensor`/`KeyboardSensor`/`closestCenter`, a `DragOverlay`, live-region screen-reader announcements, and an unconditionally-rendered keyboard-accessible "Move to column" menu per card as the guaranteed accessible fallback — none of which the old implementation had (native HTML5 `draggable` and ad-hoc pointer tracking are both inoperable by keyboard/screen-reader users). `useGdsKanbanOrientation` now handles stacked-vs-columns responsive layout automatically, replacing this app's own `mode="mobile"|"desktop"` prop and viewport `matchMedia` listener (removed from `app/sales/[brand]/sales-page-client.tsx`, along with the now-fully-dead `isMobile` state and its write-only, never-read `saleslayoutMode` localStorage persistence).
- Two disclosed trade-offs from adopting GDS's fixed `KanbanBoard` API, rather than the previous fully custom layout:
  - `KanbanColumnData.title` is a plain `string`, not a `ReactNode` — the previous two-line, differently-styled per-column forecast subtitle is now encoded into one line (e.g. `"Discovered (12) · $45,231 wtd"`).
  - `KanbanColumn` has no footer/pagination slot — the existing cursor-based infinite-scroll "load more" sentinel is now rendered inside `renderItem`'s output for the last card in a column (visually set off with a top divider), instead of as a column-level sibling element.
  - GDS's drag additionally supports same-column reordering (`SortableContext`), which this app's PATCH API can't represent (no arbitrary drop-position concept; DISCOVERED/QUALIFIED ignore `sortOrder` entirely, being ICE-score sorted) — `onMoveItem` explicitly no-ops a same-column move, preserving the old cross-column-only behavior.
- **Fixed a real build break introduced while adopting the theme change**: `Input.vars` is a function, and `createTheme()` was being called directly in `app/layout.tsx` (a Server Component), which failed `next build` with *"Functions cannot be passed directly to Client Components"* — functions can't serialize across the Server-to-Client Component prop boundary. Moved theme creation into a new `'use client'` component, `app/components/Providers.tsx`, wrapping `MantineProvider`; `layout.tsx` now renders `<Providers>` instead of constructing the theme itself. Caught by running a real `next build` (not just `tsc`/`eslint`, which don't check this) before considering the change done.
- GDS dependency versions bumped 3.10.0 -> 3.11.0 in `package.json`/`package-lock.json`.

### Known risk — not fully resolved
- **`package-lock.json`'s `integrity` hashes for `@sovereignsquad/gds-admin`/`gds-core`/`gds-theme` could not be regenerated in this sandbox** (its network egress blocks the GitHub release-tarball download needed to compute the real SHA-512). Versions and `resolved` URLs were updated consistently to 3.11.0 in both `package.json` and `package-lock.json`, but the 3 now-stale `integrity` fields were removed rather than left wrong or fabricated — a missing field fails `npm ci` with a clearer "lockfile out of sync" error than a wrong hash would, but this still needs the lockfile regenerated with real network access (a `npm install` from an environment that can reach `github.com` release assets) before or during the next Vercel deploy, otherwise `npm ci` may fail there too.

## 2.4.9

Owner reported the documentation was "hardly [sic — highly] inconsistent and incomplete." Ran two independent audits in parallel (one over README/CHANGELOG/roadmap/PROPOSAL for cross-file consistency, one over the technical reference docs cross-checked against the actual current code) and fixed every concrete finding from both — no vague impressions, only file:line-cited problems.

### Fixed — factual errors and stale claims
- **README.md's Versioning section said 2.4.3** while its own header, `package.json`, and every other doc said 2.4.8 (now 2.4.9 everywhere).
- **The 2.3.0 organization-generic-fields work was wrongly attributed to "issue #20"** in `CHANGELOG.md`, `roadmap.md`, and `PROPOSAL.md` — issue #20 has only ever been the Mongoose-models issue (confirmed by searching GitHub); no separate issue exists for the 2.3.0 work, so the false citation was removed from all 3 files rather than guessing a replacement number.
- **A "Country-based filter UI" was claimed shipped** in `roadmap.md` and `PROPOSAL.md`, and `docs/OPERATOR_GUIDE.md` claimed "Country filters are available in the pipeline UI and are visible by default" — none of this exists; the Region/Status dropdowns were removed entirely in 2.4.0 and `country` only ever appears as a display badge/table column. Corrected in all 3 files.
- **`docs/OPERATOR_GUIDE.md` said "Accept → promote toward QUALIFIED"** — false; `ACCEPT` only sets `status: 'qualified'` and bumps feedback counters, it never touches `kanbanColumn`. Corrected to describe the actual behavior.
- **`docs/OPERATOR_GUIDE.md`'s test-coverage figure was stale** ("33 unit tests + a 4-check smoke suite as of 2.2.0") against the real current count (35 unit tests, 5-check smoke suite as of 2.4.8).
- **`PIPELINE_ARCHITECTURE.md` was the most out-of-date file in the repo**: described a deleted `models/Lead.ts` as live, described QUALIFIED as agent-contact-criteria rather than the real ICE≥500 rule, claimed ICE score isn't used for column ordering (it is, for DISCOVERED/QUALIFIED, since 2.4.4), said Next.js 14 instead of 15, described a region-chip/tenantId filter UI that doesn't exist, and was missing ~9 real API routes. Rewritten to match the current codebase, with a version header added (it had none).
- **`docs/ARCHITECTURE.md` duplicated `validate-lead.ts` and `request-retry.ts` under both `app/lib/*` and `lib/*`** — both files only exist in root `lib/`; removed from the wrong section. Also removed an unverifiable "text index" claim (no `createIndex` call for one exists anywhere in the repo, and current search uses `$regex`, not `$text`).
- **`docs/DOC_LINT.md`'s own archived-file checklist pointed at the wrong paths** (`docs/architecture.md`/`docs/user-guide.md` instead of the real `_archived/architecture.md`/`_archived/user-guide.md`) — a grep run against this checklist as written would never find the real files.

### Fixed — structural issues
- **`PROPOSAL.md`'s "Completed Workstreams" section was out of chronological order** past 2.4.0 (2.4.8 appeared before 2.4.7; 2.4.5 and 2.4.1 appeared even later) — reordered to a single consistent oldest-to-newest sequence, and gave 2.4.2/2.4.3 their own dedicated headings (previously folded into an unversioned "Lead Actions and Feedback" section, inconsistent with every other version getting its own heading).
- **`roadmap.md` had no 2.4.3 entry at all**, despite `CHANGELOG.md`'s own 2.4.3 entry claiming a `roadmap.md` correction had already been made there — it hadn't been. Added the missing entry.
- **A resolved item (real-device zoom-lock verification) appeared twice in `PROPOSAL.md`** — once correctly under "Completed Workstreams," once incorrectly still listed under "Remaining Work." Removed the stale duplicate.
- **`PROPOSAL.md`'s "Remaining Work" was missing two items `roadmap.md` tracks as open** (orphaned standalone scripts with drifted kanban-column logic; real-device confirmation of the 2.4.6 zoom fix) — added both, plus a cross-reference note so `PROPOSAL.md`'s "Priority Order" doesn't silently omit `roadmap.md`'s longer-horizon "Planned" phases.
- **`CHANGELOG.md`'s "Unreleased" section sat at the very bottom**, after the oldest entry (2.1.0) — conventionally it belongs above the newest, but since nothing is actually unreleased right now, removed rather than relocated (an empty placeholder adds no value).
- **`CHANGELOG.md`'s 2.1.0 entry said "Current production version"** — hasn't been true since 2.2.0 shipped, 8 versions ago. Reworded to describe it as this changelog's baseline, not a status claim.
- **A "known issues carried forward" list inside the 2.2.0 entry named 3 items as still-open** (outcome-logs collection split, Mongoose models, pagination shapes) that are all now resolved (2.2.3, 2.4.7, 2.4.7 respectively) — added strikethrough + resolution pointers, matching the pattern already used elsewhere in this file.
- **The last 3 changelog entries (2.4.6, 2.4.7, 2.4.8) stopped mentioning the 3 pre-existing ESLint warnings** that every entry since 2.4.4 had explicitly carried forward per `CLAUDE.md`'s record-don't-drop rule — added the note back to each.

### Housekeeping
- Deleted `development.md` — 0 bytes, no doc anywhere described its intended purpose, and it was only ever referenced (incorrectly, as an "archived" file) in `docs/DOC_LINT.md`'s now-fixed checklist.
- Added explicit "⚠️ ARCHIVED" banners to all 4 `_archived/*.md` files — `_archived/architecture.md` and `_archived/user-guide.md` previously had no internal marker at all and carried the exact same titles as their live counterparts, making them easy to mistake for current docs if reached via search rather than the README's index.
- Added a one-line pointer from `docs/STACK_AND_DEPENDENCIES.md`'s Mongoose row to `_archived/STACK_DECISION.md`'s original "why Mongoose" rationale, which existed only in the archived file and was never migrated to the live stack doc.
- `README.md`: added the Metrics/Search Learning view modes and several missing key endpoints (`/api/leads/columns`, `PUT /api/leads/[id]`, `/api/search`) to the feature/endpoint lists, and added `vitest`/`test:smoke` to Quick Start (previously only `tsc`/`lint` were documented, despite both being part of `CLAUDE.md`'s mandatory gate).

## 2.4.8

Owner reported the kanban ICE-score sort (2.4.4) was "still not working" and asked where the sort computation actually runs, concerned about heavy client-side work.

### Architecture confirmation (not a bug)
The sort itself is entirely server-side: `GET /api/leads/columns` sorts DISCOVERED/QUALIFIED via a MongoDB aggregation (`ICE_SCORE_AGGREGATION_EXPR` in `lib/kanban-column.ts`), and the frontend (`app/kanban.tsx`) renders whatever order the server returns without ever re-sorting client-side. `app/constants.ts`'s `getIceScore()` is the only client-side ICE computation, and it's a trivial per-card multiply used purely for the displayed badge — not for ordering anything.

### Fixed
- **Found a real, concrete bug while investigating: `PUT /api/leads/[id]` could silently corrupt a lead's stored `ice` field, breaking the sort for that document.** `POST /api/leads` runs the whole request body through `normalizeLead()`, which coerces `ice.impact`/`confidence`/`ease` to real numbers via `ensureNumber()`. `PUT /api/leads/[id]` — the enrichment/update path — does not: it copies `body.ice` straight into the update document (`updateData.ice = body.ice`), and `validateLeadPayload`'s range check (`Number(ice.impact)` between 1 and 10) only *validates* the value, it never *coerces* the stored one. A request with numerically-valid but string-typed ICE values (e.g. `"8"` instead of `8`) — plausible from any caller that serializes numbers as strings somewhere in its own pipeline — would pass validation and get persisted as strings. MongoDB's `$multiply` throws on a string operand, which fails the *entire* aggregation for that column (not just the one bad document), returning a 500 that the frontend's `catch` block silently logs to console — leaving the column showing stale or unsorted data with no visible error. Fixed by coercing `ice` to real numbers in the PUT handler before storing, matching what `POST` already does.
- **Made the sort aggregation itself resilient regardless**, so it can't be broken this way again even by some other write path or already-corrupted historical data: `ICE_SCORE_AGGREGATION_EXPR` now reads each ICE field through `$convert` (`to: 'double', onError: 0, onNull: 0'`) instead of a bare `$gt`/`$multiply` on the raw stored value. This recovers the real number from a numeric-string field (self-healing any already-corrupted document without a migration) and falls back to 0 for anything genuinely non-numeric or missing, routing to the existing `scoreProfile.finalBlended.ice` fallback instead of throwing.

### Verification note
This sandbox has no MongoDB credentials configured, so the exact shape of any already-live corrupted documents (if any exist) couldn't be directly inspected before or after this fix — the root cause was identified by tracing the actual code paths (validation vs. normalization vs. storage), not by guessing. The fix is self-healing on the read side regardless of whether this specific corruption is what the owner hit, so it resolves the symptom either way. Full quality gate (`tsc`, `eslint`, `vitest` 35/35, smoke 5/5) passes; a live device/production check of the kanban sort is the way to get 100% confirmation. The same 3 pre-existing `react-hooks/exhaustive-deps` ESLint warnings (`app/outreach/compose-modal.tsx`, `app/outreach/templates/page.tsx`, first recorded in 2.4.4) remain, in files untouched by this or any subsequent change through 2.4.7.

## 2.4.7

Resolved the two "flag only" decisions left open from the second audit pass (GitHub issues #20 and #21) — both were closed previously with only their low-risk sub-fixes shipped, the actual decisions never made.

### Removed
- **`models/Lead.ts`, `models/OutcomeLog.ts`, `models/SearchLearning.ts` deleted** (issue #20, decision: delete). Re-verified zero importers anywhere in `app/`, `lib/`, or `scripts/`. Their schemas had drifted from reality (a `status` enum unrelated to the real `kanbanColumn` vocabulary, missing `seyu` field equivalents), and nothing in the codebase — no comment, no doc, no in-progress code — signaled an actual planned migration to Mongoose; the app has exclusively used the raw `mongodb` driver for all real reads/writes since before this repo's own tracked history. `mongoose` remains a legitimate direct dependency: several standalone maintenance scripts (`scripts/seed.js`, `scripts/check-db.js`, `scripts/audit-db.js`, `scripts/fix-*-region*.js`) use `mongoose.connect()` purely as a connection helper, then operate via the raw driver underneath (`mongoose.connection.db.collection(...)`) — none of them import the deleted model files. `docs/STACK_AND_DEPENDENCIES.md` updated to describe this accurately.

### Changed
- **Unified the three lead-listing endpoints' pagination shapes** (issue #21, decision: unify on cursor pagination). `/api/leads`, `/api/search`, and `/api/leads/columns` now all return `hasMore`/`nextCursor`.
  - `/api/leads`: cursor support added **additively and opt-in** — a request without `cursor` behaves exactly as before (same `page`/`limit`/`totalPages`/`total`/`returned` fields, same default sort), because this endpoint has a real external consumer this repo doesn't fully control: the research agent's one-shot `GET /api/leads?brand=<tenantId>&limit=1000` listing call (referenced in `agent-runtime/schema-mapper.js` and both discovery/enrichment prompts). Sending `cursor=<value>` switches to a `createdAt desc, _id desc` sort and returns `hasMore`/`nextCursor` for that request only.
  - `/api/search`: fully converted, since its only real consumer is this app's own predictive search bar (verified — no other in-repo or external caller found). `results` renamed to `leads`; the previous `total` field (which was actually just `results.length`, a smaller-scale version of the same naming trap `/api/leads` had before 2.2.2) replaced with a real `count` from `countDocuments`. Cursor pagination works when a specific `brand` is requested (the only mode the search bar uses); querying across every brand at once merges two independently-sorted collections with no single resumable cursor position, so that mode honestly stays a flat capped list (`hasMore` always `false`) rather than faking a cursor that couldn't actually resume correctly.
  - `sales-page-client.tsx`'s table-view fetch switched from a single hard-capped `limit=5000` request to looping on `hasMore`/`nextCursor` — removes a silent-truncation risk for any brand that ever exceeds 5000 leads, and the predictive search handler updated to read `data.leads` instead of the now-renamed `data.results`.

### Verification note
Confirmed via direct grep across `app/`, `lib/`, `agent-runtime/`, and `scripts/` that no in-repo code reads `/api/leads`'s `page`/`total`/`totalPages` fields (only the external research-agent integration touches this endpoint outside the frontend, and only to build the request URL, not parse pagination metadata from the response) — this is why the additive, non-breaking approach was chosen for `/api/leads` specifically rather than a hard cutover. The same 3 pre-existing `react-hooks/exhaustive-deps` ESLint warnings noted since 2.4.4 remain, in files untouched by this change.

## 2.4.6

### Fixed
- **The header's view-mode dropdown (and, latently, every other Mantine input in the app) still force-zoomed on iOS Safari despite the 2.4.1 fix.** Root cause: the 2.4.1 fix added `input, select, textarea { font-size: 16px }` (a bare element selector, CSS specificity 0-0-1), but Mantine's own compiled stylesheet sets each input's font-size via a hashed class selector (`.m_8fb7ebe7 { font-size: var(--input-fz, ...) }`, specificity 0-1-0) — which always outranks a type selector regardless of source order. That rule silently never applied to any Mantine `Select`/`TextInput`/etc., only to plain native inputs outside Mantine, which is why the search bar (added later, also Mantine) may have been just as affected and the dropdown specifically was reported. Confirmed by inspecting Mantine's actual shipped CSS (`node_modules/@mantine/core/styles.css`) rather than guessing, and confirmed no existing `!important` font-size rule in Mantine's stylesheet that could out-rank a fix. Added `!important` to the global rule, which unconditionally wins the cascade.
- Widened the header's view-mode `Select` from 132px to 168px to comfortably fit "Search Learning" at the now-correctly-enforced 16px font (it was previously rendering at Mantine's much smaller "xs" font size, ~12px, before this fix took effect).

### Verification note
This is an iOS Safari-only rendering behavior with no equivalent in desktop/headless Chromium, so it cannot be visually screenshotted from this sandbox even with a working browser-automation setup (Playwright itself couldn't be installed here either — it re-triggers `npm install`, which fails on this repo's private GDS package tarballs, the same longstanding sandbox constraint noted elsewhere in this changelog). What *was* verified directly: the compiled CSS served by a real `next dev`/`next build` run contains the `!important` rule exactly as written, and per the CSS specification `!important` unconditionally overrides any non-`!important` declaration regardless of selector specificity or source order — this is deterministic, not something that requires a live device to confirm. Real-device (iOS Safari) confirmation is still recommended before considering this closed. The same 3 pre-existing `react-hooks/exhaustive-deps` ESLint warnings noted since 2.4.4 remain, in files untouched by this change.

## 2.4.5

Three real bugs from a live device screenshot review of the header/search bar and a desktop-width lead detail panel.

### Fixed
- **Header and search bar overflowed the screen on narrow viewports.** The header `Group` used `wrap="nowrap"` with three lines of verbose dimmed text ("408 leads · updated 11:15:48 AM", "Forecast: $1,382,687 weighted") next to the view-mode `Select`; on a phone-width screen the combined row was wider than the viewport, and since neither side could shrink or wrap, the `Select` (and, once the page had any horizontal overflow, everything below it) rendered partly or fully off-screen instead of clipping safely. Reworked the header to two compact rows — brand name + view selector (selector now has a fixed, safe width and the title truncates instead of forcing width), then a single terse `<leads count>` / `<weighted forecast>` line, dropping the "· updated HH:MM:SS" and "Forecast:"/"weighted" wording entirely per the owner's requested format. Also added a global `overflow-x: hidden` safety net (`app/globals.css`) so a future stray element can't reproduce a screen-wide overflow again.
- **The desktop/tablet-width (≥1280px) lead detail panel was missing its entire body.** `LeadDetailModal` (`app/detail.tsx`) renders one of two GDS overlays depending on viewport width: `AdminModal` (mobile, <1280px) or `AdminDetailDrawer` (desktop/tablet, ≥1280px). The `AdminModal` call passed `{content}` (ICE score, contacts, pros/cons, value proposition, feedback history, and every action button/decline-reason/annotation field) as children — but the `AdminDetailDrawer` call only ever passed `metadata` (just the entity name and 3 badges), never `content`. Reading `AdminDetailDrawer`'s real source (`packages/gds-admin/src/AdminOverlays.tsx`, via `raw.githubusercontent.com`) confirmed it renders `{media}`, `{metadata}`, then `{children}` — so the drawer had been silently missing everything past the name/badges on any screen ≥1280px wide, with no way to Accept/Decline/Pin/Refresh/Delete a lead from that view at all. Added `{content}` as `AdminDetailDrawer`'s children, matching the `AdminModal` branch.
- **A quick tap on a card (or its Preview button) could leave a permanent, stuck drag-ghost.** `app/kanban.tsx`'s long-press-to-arm drag gesture starts a 200ms timer on `pointerdown`; the accompanying `pointerup`/`pointercancel` watcher only removed its own listeners, it never cancelled the pending timer. A normal quick tap releases the pointer well before 200ms elapses, so the timer still fired afterward and set `dragState` — with no future `pointerup` on that now-released `pointerId` ever going to arrive to clear it (each new touch gets its own `pointerId`). The result: the floating ghost label and the source card's dimmed (`opacity: 0.4`) state got stuck on screen indefinitely after ordinary taps, exactly as seen live (a stray "Liverpool FC" ghost label sitting over a permanently-dimmed card). Fixed by cancelling the arm timer on `pointerup`/`pointercancel`, not only on excess movement.

### Note
Same 3 pre-existing `react-hooks/exhaustive-deps` ESLint warnings remain in untouched `app/outreach/*` files, carried forward as recorded.

## 2.4.4

Owner-specified kanban auto-classification/sort business rule, previously only partially wired (a `deriveKanbanColumn` existed with the wrong thresholds and 3 tiers including an auto-`ENGAGED` promotion; `ICE_QUALIFIED_THRESHOLD = 500` was declared in `app/constants.ts` but never referenced anywhere — strong evidence this 500-threshold rule was the original intended design that never got finished).

### Changed
- **`lib/kanban-column.ts` rewritten to a strict 2-tier rule.** `DISCOVERED` = ICE score < 500, `QUALIFIED` = ICE score ≥ 500. The old 3-tier version (480/720 thresholds, auto-promoting to `ENGAGED`) is gone — `ENGAGED`/`PROPOSAL`/`WON`/`LOST` are never reached by automatic classification, only by an explicit user action (drag-and-drop, Accept, Pin, etc.). Added `AUTO_MANAGED_COLUMNS`/`isAutoManagedColumn()` and `ICE_SCORE_AGGREGATION_EXPR` (a Mongo aggregation expression computing the same score as `app/constants.ts`'s `getIceScore()`, for server-side sorting without a stored, denormalized field).
- **`PUT /api/leads/[id]` now auto-reclassifies on score change.** If a partial update includes `ice` and does not also explicitly set `kanbanColumn`, and the lead is currently in `DISCOVERED` or `QUALIFIED`, the route recomputes the ICE score and derives the new column. Leads already moved to any of the 4 manual columns are never touched by this — moving a lead out of the auto-managed pair is a one-way door, matching the owner's spec ("If a card scores changes in Discovery and Qualified columns they change sort and even columns automatically by the rules. All other columns are manually sorted by the user").
- **`GET /api/leads/columns` now sorts `DISCOVERED`/`QUALIFIED` by computed ICE score, high to low — no other sort.** Previously all 6 columns used the same `{ sortOrder: -1, createdAt: -1 }` sort, which meant the two auto-managed columns weren't actually score-ordered at all despite the intent. The route now branches: the two auto-managed columns run an aggregation (`$addFields` + `$sort` on the computed score) with cursor pagination re-encoded as `<iceScore>|<id>`; the 4 manual columns keep their original `sortOrder`-based query and `<sortOrder>|<id>` cursor, unchanged.
- `app/constants.ts`'s `COLUMNS` metadata descriptions rewritten to state the rule directly ("Auto-managed: ICE < 500, sorted high to low", etc.); the now-superseded, always-unused `ICE_QUALIFIED_THRESHOLD` constant was removed in favor of `lib/kanban-column.ts`'s `QUALIFIED_ICE_THRESHOLD`.
- `tests/lib/kanban-column.test.ts` rewritten for the new 2-tier thresholds (was still asserting the old 480/720/`ENGAGED` behavior) plus new coverage for `isAutoManagedColumn()`.

### Fixed (pre-existing, unrelated to this task, caught by the quality gate before pushing)
- `app/detail.tsx` (2 call sites) and `app/table.tsx` (2 call sites): implicit-`any` `tsc` errors on GDS admin-component callback parameters (`AdminSelect`/`AdminTextarea`/`AdminDataTable` are typed `any` in this sandbox's local stub packages, so inline callback parameters had no contextual type). Added explicit parameter types; no behavior change. These were already present on `main` prior to this change — not introduced by this task, but fixed here since the zero-tolerance gate covers whatever this push adds to `main`.

### Note
3 pre-existing ESLint warnings (`react-hooks/exhaustive-deps` in `app/outreach/compose-modal.tsx` and `app/outreach/templates/page.tsx`) remain, in files untouched by this change — carried forward as recorded, not fixed in this pass.

### Not in scope
`lead-feeder-agent.js` and `scripts/migrate-check-schema.js` contain their own, separate, older kanban-column-derivation logic (different thresholds, including direct writes to `ENGAGED`/`PROPOSAL`). Neither is wired into any `npm` script or the running app — same unused/orphaned status as the Mongoose models already tracked as an open decision in `roadmap.md`. Left untouched; flagging here so the drift is a recorded fact, not a silent gap.

## 2.4.3

### Fixed
- **Removed the header's "Asc ↑"/"Desc ↓" sort button — it never sorted anything.** Owner flagged it directly after the header decluttering made it more visible. Investigation confirmed `sortOrder` state only toggled the button's own label; it was never passed to `KanbanBoard` or `TableView`, and `sortKey` was set once and never read anywhere. This predates the 2.4.0 rework (it was already non-functional in the original header) — it was preserved rather than audited when the two filter dropdowns were removed. Removed the button and the dead `sortKey`/`sortOrder` state entirely, along with the now-unused `Button` import.
- Corrected two more false "shipped" claims in `roadmap.md`'s UX history ("ICE-score sort controls for kanban and list view", "Kanban ICE/name ascending/descending sort behavior") — same non-functional button, never actually true.

### Clarified (not a bug)
- Owner asked whether an "Arsenal FC" lead had been deleted, comparing a screenshot search result on Seyu's board against a later one on CogMap's board where it didn't appear. These are two different brands with entirely separate MongoDB collections (`leads` vs `seyu_leads`) — a lead existing for one brand and not the other is expected, not data loss. Confirmed the 2.4.1 dedup fix in `/api/search` is scoped per-brand (inside the per-`brandKey` loop) and is read-only regardless — it cannot delete or cross-contaminate data between brands.

## 2.4.2

### Fixed
- **Every `PATCH /api/leads` action — not just drag-and-drop — was silently failing.** Reported as "drag and drop not permanent, looks like move but immediately refreshes and stays in the original." Root cause: `PATCH /api/leads`'s documented contract (`docs/OPERATOR_GUIDE.md`) expects the lead `id` as a URL query parameter (`?id=<id>`), matching what the route handler actually reads (`searchParams.get('id')`) — but both client call sites, `handleAction` (`sales-page-client.tsx`, used by every detail-modal action: Accept, Decline, Pin, Refresh, Modify, Delete) and `handleMove` (`kanban.tsx`, drag-and-drop), only ever sent `id` in the JSON body, never the URL. Every PATCH request has been returning 400 "Missing id" since these call sites existed. For drag-and-drop specifically, the failed request's `catch` block reloads the source column from the server (where nothing had changed), which is exactly why the card visually moved (optimistic UI) then snapped back. Added `url.searchParams.set('id', leadId)` to both call sites, matching the route's actual, documented contract.
- Corrected the "Lead Actions and Feedback" section of `PROPOSAL.md`, which claimed "Actions verified: ACCEPT, DECLINE, PIN, REQUEST_REFRESH, COLUMN_MOVE, DELETE" — they were not actually working given the bug above; removed the false claim.

## 2.4.1

Three real bugs found on the freshly-shipped 2.4.0 search bar and kanban board, reported live from a device screenshot.

### Fixed
- **The whole page force-zoomed on focusing the search input.** A different mechanism from the pinch/double-tap zoom fixed in 2.2.1: iOS Safari zooms the entire viewport in when a focused input's computed font-size is below 16px, regardless of `touch-action` or the viewport meta tag. Mantine's default input sizes render below that threshold. Added a global `input, select, textarea { font-size: 16px }` rule in `app/globals.css` — the standard, root-cause fix for this specific iOS behavior.
- **"The input field is not the input field."** The 2.4.0 search bar used GDS's `SearchableSelect` (`@sovereignsquad/gds-core`), which turned out to be the wrong component for this job: reading its real source shows it's a closed combobox *picker* — the visible box is a button (`InputBase component="button"`) that only opens a dropdown, and the actual typing field is a separate, plain `Combobox.Search` element that only appears once the dropdown is open and doesn't look like an input (no visible border). This is correct for a "select one item from a searchable list" UI, not for an always-visible live search bar. Replaced with a plain, always-editable Mantine `TextInput` bound directly to the query, with a custom dropdown of results rendered below it as the user types — matching what was actually asked for.
- **Duplicate results in search** (e.g. "Arsenal FC — Sports" appearing twice). `GET /api/search` never applied the fingerprint-based dedup (`/api/leads`'s GET handler already does this — the underlying collections can contain duplicate-fingerprint documents). Added the identical dedup-by-fingerprint-newest-wins logic to `/api/search`.

### Documentation
`docs/ARCHITECTURE.md` updated to describe the new plain-input search bar (correcting the stale `SearchableSelect` reference from 2.4.0) and the new focus-zoom CSS fix.

## 2.4.0

Kanban board UX overhaul (issue #23), from an owner screenshot review of the pipeline header and mobile filter bar.

### Added
- **Predictive lead search**: a new search bar, centered directly under the page header, using GDS's `SearchableSelect` (`@sovereignsquad/gds-core`) — debounced, async-loaded against the existing `GET /api/search?q=&brand=` endpoint, with loading/empty/error states built in. Selecting a result opens the lead detail modal directly.
- **Drag-and-drop between kanban columns, rebuilt from scratch.** It did not exist in the code prior to this release — `handleMove()` was already correctly wired to `PATCH /api/leads` with `action: COLUMN_MOVE`, but nothing ever called it; no `draggable`, drag events, or pointer handlers were present anywhere in `app/kanban.tsx`. (Changelog/roadmap history describes "pointer-based drag-and-drop" as previously shipped; it isn't present in the code as it stood before this release, likely lost in an earlier rewrite to cursor-paginated columns.) Implemented with Pointer Events (not native HTML5 drag-and-drop, for touch support) using a 200ms long-press-to-arm gesture so normal scrolling and tap-to-preview keep working — only a deliberate hold-then-move starts a drag. Includes a floating ghost label following the pointer, a dashed-highlight drop-target column, optimistic card removal from the source column on drop, and full cleanup on pointer cancel/interrupt.
- **Ticket size on each lead card**: a new `getTicketSize()` helper (`app/constants.ts`) surfaces the estimated deal value — CogMap leads use `estimated_annual_revenue_usd` directly (USD); Seyu leads don't have a single per-lead figure in the schema, so it's derived by summing each of that lead's own `pricingByCompany` entries using the same `max(annual_fee_eur, monthly_eur*12 + upfront_eur)` formula the forecast endpoint already used server-side (EUR). Shown in the card's metadata row alongside Region/ICE/Size/Contact.
- **Discounted (pipeline-weighted) forecast per kanban column header**: `GET /api/boards/[brand]` already computed this for CogMap (`forecast.pipeline[COLUMN].weightedRevenue = rawRevenue × probability`, where probability comes from `lib/pipeline-weights.ts`) but only ever surfaced the aggregate total in the page header. Now shown per-column. Extended the same computation to Seyu, which previously had no per-column breakdown at all (only per-company) — a new aggregation groups each lead's own pricing-block value by `kanbanColumn` before applying the same weight table.

### Changed
- **Header layout**: the view-mode selector (Kanban/Table/Metrics/Search Learning) is now pinned to the header's top-right (`wrap="nowrap"`, so it can no longer wrap below the title on narrow viewports as it did before). The Region and Status filter dropdowns are removed entirely, from the UI and from the `filteredLeads` logic in `sales-page-client.tsx` that depended on them — the kanban board already groups by status via its columns, and the region filter had no other consumer.
- The page header's forecast text now shows `€` for Seyu (previously hardcoded `$` regardless of brand, which was wrong once Seyu forecasts existed).

### Documentation
`docs/ARCHITECTURE.md`, `roadmap.md`, `PROPOSAL.md` updated. Full deliverable breakdown and the CogMap/Seyu ticket-size ambiguity this shipped a default answer for: issue #23.

## 2.3.2

### Fixed
- **The image placeholder was still showing** on the "Top Queries" cards in `app/search-learning.tsx` after the 2.3.1 kanban-card fix, because that's a *second, separate* `AdminResourceCard` usage the 2.3.1 fix never touched (only the kanban `LeadCard` was switched to `ProductCard`). Investigated `AdminResourceCard`'s real source directly (`packages/gds-admin/src/AdminResourceManager.tsx`) rather than guessing why the earlier fix wasn't enough: it wraps `MediaPreviewCard` and has an explicit `hideWhenNoMedia?: boolean` prop, documented inline as *"Omit the media area entirely for records with no media, instead of a placeholder block"* — defaulting to showing the placeholder unless a consumer explicitly opts in. Neither `AdminResourceCard` usage in this repo ever passed it. Added `hideWhenNoMedia` to the `search-learning.tsx` card. Also verified `app/table.tsx`'s `AdminDataTable` mobile-card path has no media/placeholder chrome of its own around its fully custom `renderMobileCard` render prop — confirmed clean, not a source of this issue.

## 2.3.1

### Fixed
- **Kanban cards no longer show an empty image placeholder.** `LeadCard` (`app/card.tsx`) used `AdminResourceCard` (`@sovereignsquad/gds-admin/client`), which always reserved a media/thumbnail box even though `Lead` has no image/logo field anywhere in the data model — there is currently no case where a lead actually has an image. Switched to `ProductCard` (`@sovereignsquad/gds-core/client`), whose `media`/`icon` props are genuine optional `ReactNode`s rendered bare — omitting them renders nothing, no placeholder. Verified against the real component source (`packages/gds-core/src/ProductCard.tsx` in `sovereignsquad/general-design-system`), not guessed: this sandbox can't install the real `@sovereignsquad/gds-*` packages (same GitHub release-tarball network constraint documented elsewhere), but `raw.githubusercontent.com` was reachable, so the actual source was read directly to confirm the prop contract before writing this fix. Card density/variant set to `compact`/`sm` per the design system's dedicated tight-list contract.
- Fixed stale documentation in `docs/ARCHITECTURE.md`'s Outcome Log section, which still described issue #11 (the `outcomeLogs`/`outcomelogs` collection split) as an open known issue — it was actually resolved in 2.2.3 and the doc was never updated to say so.

## 2.3.0

### Changed — Breaking API/data contract change
- **Resolved the organization-genericness complaint** (owner-requested, no tracked GitHub issue — this predates the audit-remediation epic's issue numbering): the value-proposition fields were named per-brand (`pro_for_cogmap`/`con_for_cogmap` for CogMap, `pro_for_seyu`/`con_for_seyu` for Seyu), which doesn't generalize to onboarding a new organization without a code change. Both brands now read and write one shared, generic field pair: `pro_for_organization`/`con_for_organization`. This is a **hard cutover** — no fallback, no dual-read, old field names are no longer recognized anywhere in the app.
- To avoid any window where existing leads' pros/cons would appear empty, a temporary one-time migration endpoint was deployed to production *before* the code change shipped, renaming the field in-place across both live collections via MongoDB's `$rename`: 408 documents in `leads`, 492 in `seyu_leads` (900 total), verified afterward to have zero documents left with the old field names. The endpoint was deleted once the migration was confirmed.
- Removed the now-obsolete "forbidden cross-brand pro/con field" validation rule from `lib/validate-lead.ts` (`pro_for_seyu` was rejected on a `cogmap` payload and vice versa) — there's nothing left to forbid once both brands share the same field name. The separate, unrelated forbidden-vocabulary check on free-text `value_proposition` content is untouched.
- `models/Lead.ts` (unused Mongoose model) had its pro/con field names corrected to match; the file remains unimported dead code — whether to delete it entirely or repair it fully as a future migration path is still an open decision.
- Updated `tests/lib/validate-lead.test.ts` and `tests/smoke/validate-lead.smoke.ts`, which had asserted the old brand-forbidden behavior, to reflect the new generic-field reality.
- Updated the `agent-runtime/` artifacts (added to this repo by the OpenClaw research agent) to match: `tenants.json`'s `cogmap`/`seyu` `brandFields.pro`/`.con` now both point at `pro_for_organization`/`con_for_organization`, `cogmap`'s now-meaningless `forbiddenFields: [pro_for_seyu, con_for_seyu]` was removed, and `seyu`'s `qualityGate.requiredFields` updated to the generic names. `schema-mapper.js`'s `_mapCogmapSeyu()` dropped ~35 lines of now-unnecessary cross-brand field-name reconciliation (both tenants already use the same field name, so there's nothing left to remap), and `_mapClassScout()`'s `leadOnlyFields` strip-list updated to match. `unified-enrichment-prompt.md`'s Seyu priority list updated. Verified via a standalone script exercising `mapToApiPayload`/`validateForTenant` for both tenants.

## 2.2.3

### Fixed
- **Resolved issue #11**: `/api/outcome-logs` (both GET and POST) read/wrote the `outcomeLogs` (camelCase) MongoDB collection, while every other outcome-logging call site (`app/api/leads/route.ts`, `app/lib/lead-actions.ts`, `app/api/admin/cron-status/route.ts`, `scripts/pipeline-monitor.js`) used `outcomelogs` (lowercase). Confirmed via a temporary, unauthenticated, read-only diagnostic endpoint deployed to production (`GET /api/admin/diag-outcome-logs`, removed immediately after use) that `outcomeLogs` held 0 documents while `outcomelogs` held 2,276 with same-day activity. `/api/outcome-logs` now points at `outcomelogs`, matching the rest of the codebase; its GET response will now reflect the real outcome history for the first time.

### Known issues carried forward (still open, still requires an owner decision — not fixed in this release)
- #20 — unused Mongoose models (`models/Lead.ts`, `OutcomeLog.ts`, `SearchLearning.ts`): still requires an owner decision (delete vs. repair).

## 2.2.2

### Fixed
- Fixed a misleading `total` field in `GET /api/leads`'s response: it previously held the count of leads returned on the current page (post-dedup), not the real total across all pages — a name that actively invites a wrong assumption, even though `totalPages` next to it was already computed from the real count. `total` now reflects the true grand total (matching `totalPages`); the per-page count is exposed separately as `returned`. Verified no existing frontend consumer read the old `total` field before renaming (fixes #21's low-risk sub-fix; the larger 3-endpoint pagination-shape unification remains out of scope, tracked in #21).

### Known issues carried forward (unchanged, still open, still require owner input — not fixed in this release)
- #11 — `outcomeLogs`/`outcomelogs` MongoDB collection-name split: still requires a direct production-database check before any code change, per the issue's own explicit non-goal. No `MONGODB_URI` credentials are available in the development environment to perform that check.
- #20 — unused Mongoose models (`models/Lead.ts`, `OutcomeLog.ts`, `SearchLearning.ts`): still requires an owner decision (delete vs. repair) per the issue's own explicit non-goal.

## 2.2.1

PWA and zoom-lock fix, reported live on `/sales/seyu` in production.

### Fixed
- **PWA installability**: `manifest.json` and `app/layout.tsx` referenced `/icon-192.png` and `/icon-512.png`, but neither file existed in `public/` — a manifest with 404ing icons fails browser installability checks outright, which alone explains why the app never behaved as an installable PWA regardless of prior PWA-hardening work. Added real, valid PNG icons at both sizes (placeholder design: dark-navy background matching `theme_color`, centered accent shape within the maskable safe zone).
- **No service worker existed anywhere in the codebase.** Added a minimal one (`public/sw.js`) that only precaches the static app-shell assets (manifest, icons) and passes everything else — all page navigations and all `/api/*` calls — straight through to the network, so there's no risk of serving stale kanban/lead data from a cache.
- **Pinch-zoom still worked despite three prior fix attempts** (`8f97f44`, `396ea1e`, and earlier), because all of them relied solely on the `<meta name="viewport">` tag's `maximum-scale`/`user-scalable=no`. **iOS Safari has ignored those two viewport properties since iOS 10**, as a deliberate Apple accessibility decision — no amount of retuning that one meta tag was ever going to fully prevent pinch-zoom on iPhone. Added two additional layers that iOS Safari does respect: a global CSS `touch-action: manipulation` rule (`app/globals.css`), and a JS-level `gesturestart`/`gesturechange` + multi-touch `touchmove` guard (`app/components/PwaSetup.tsx`) for older/edge-case Safari behavior.

### Known limitation
Real-device verification (iOS Safari pinch behavior, Android Chrome install prompt) could not be performed from this environment — verified via `next build` + a manual Lighthouse/DevTools installability check only. Flagged explicitly rather than claimed as fully proven (tracked in issue #22).

## 2.2.0

Security, dependency, and code-quality remediation following a two-pass engineering audit (tracked in GitHub issues #1–#21). No breaking API/UI changes.

### Security
- Fixed an API-key authentication bypass: `requireApiKey` previously allowed any request through if the `x-api-key` header was simply omitted, even when `SLG_API_KEY` was configured — only a *wrong* key was rejected. Now a missing header is rejected identically to a wrong one.
- Added the missing `requireApiKey` check to `POST /api/outcome-logs`, which had no auth gate at all, unlike every sibling write endpoint.

### Fixed
- Fixed a build-breaking undefined `columnWidth` reference in `KanbanBoard` (`app/kanban.tsx`), derived from the existing `mode` prop.
- Fixed `PUT /api/leads/:id` silently skipping all validation that `POST` enforces — malformed URLs, out-of-range ICE scores, and forbidden cross-brand fields could previously be written on update. `validateLeadPayload` now accepts a `{ partial: true }` option for update-shaped payloads.
- Fixed `Lead.region`'s frontend type (`app/types.ts`), which listed values (`USA`, `APAC`, `LATAM`, `EUROPE`, `GLOBAL`, `AFRICA`) that don't match what the backend actually produces (`US`, `CEE`, `MENA`). Tightening the type surfaced a live bug: the lead detail modal's region-color badge compared against `'USA'` instead of `'US'`, so it always fell through to the default gray color for US-region leads — fixed in the same change.
- Fixed `search-learning`'s error responses, which exposed raw exception messages directly as the `error` field; aligned to the `{ error, details }` shape used elsewhere.
- Fixed a Next.js 15 build failure (`Type '{ params: {...} }' does not satisfy the constraint 'PageProps'`) on `app/sales/[brand]/page.tsx` by splitting it into an async Server Component (awaits `params`) and a new `sales-page-client.tsx` Client Component receiving `brand` as a plain prop — no React 19 upgrade required.

### Changed — Dependencies
- Upgraded Next.js from `14.2.18` (deprecated, 14 open CVEs including HTTP request smuggling and cache poisoning, no patch in the 14.x line) to `15.5.13`+, the minimum version resolving all listed advisories. Updated the two dynamic API route handlers using `params` for Next 15's async request API.
- Established a working ESLint configuration — `npm run lint` previously had no config or dependency at all and just launched an interactive setup wizard. Enabling it immediately surfaced a real Rules-of-Hooks violation in `LeadDetailModal` (conditional `useState`/`useEffect` calls), fixed in the same change.
- Migrated ESLint 8 (deprecated) to ESLint 9 with a flat config (`eslint.config.mjs`, bridging `eslint-config-next`'s legacy preset via `@eslint/eslintrc`'s `FlatCompat`). Also switched the `lint` script from the deprecated `next lint` wrapper to the plain `eslint .` CLI.

### Changed — Code quality / de-duplication
- Removed `app/lib/validate-lead.ts`, a byte-identical, unreferenced duplicate of the real `lib/validate-lead.ts`.
- Removed two orphaned, never-imported modules documented as integrated but actually dead: `app/lib/ai-scoring/` (also internally broken — it referenced a stale `pro_for_slg`/`con_for_slg` field that never existed) and `lib/lead-validator.ts` (disagreed with the real, live validator on several rules).
- Consolidated `buildFingerprint()` (dedup hash), `deriveKanbanColumn()` (ICE→column mapping, plus removed a dead branch that could never execute), `isMongoConfigured()` (previously duplicated in 4 files with drift — the duplicates checked two env vars, `MONGODB_URI_LEADS`/`MONGODB_URI_CLASSCOUT`, that the real connection never reads, risking a false-positive "configured" check), and the pipeline-weight forecast math (previously triplicated across `stats`, `boards/[brand]`, and `forecast/export` routes) into shared modules: `lib/fingerprint.ts`, `lib/kanban-column.ts`, `lib/pipeline-weights.ts`, `lib/tenant.ts`.
- Fixed a filter bug in `/api/health`'s opt-in `tenantLeadCounts`: it used a raw exact-match `{ tenantId }` filter instead of the `tenantFilter()` pattern (matching both `'default'` and documents with no `tenantId` field) used everywhere else, undercounting when a caller explicitly requested `?tenantId=default`.

### Documentation
- Added `CLAUDE.md`, recording mandatory operating rules for any Claude session working in this repo (zero-tolerance quality gate, work-from-issues, documentation-mandatory, DoD, verify-don't-guess, and branch/push authorization for `dev`/`preview`/`main`).
- Updated `README.md`, `docs/ARCHITECTURE.md`, `docs/STACK_AND_DEPENDENCIES.md`, `docs/OPERATOR_GUIDE.md`, `PIPELINE_ARCHITECTURE.md`, `roadmap.md`, `PROPOSAL.md`, and `deployment.md` to reflect the above and correct several pre-existing documentation/reality drifts found along the way (stale package references, a corrupted architecture diagram, broken cross-links to non-existent files, and a security description matching the pre-fix auth-bypass behavior).

### Known issues carried forward as of 2.2.0 (all since resolved — kept here as the historical record, not current status)
- ~~`outcomeLogs` vs `outcomelogs`: the dedicated `/api/outcome-logs` endpoint reads/writes a different-cased MongoDB collection than every other outcome-logging call site.~~ **Fixed in 2.2.3** (issue #11).
- ~~Three Mongoose models (`models/Lead.ts`, `OutcomeLog.ts`, `SearchLearning.ts`) are unused and have schemas drifted from reality. Needs an owner decision: delete, or repair as a future migration path.~~ **Resolved in 2.4.7** (issue #20, decision: delete).
- ~~Three lead-listing endpoints (`/api/leads`, `/api/search`, `/api/leads/columns`) use three incompatible pagination shapes, one with a misleadingly-named `total` field.~~ **Resolved in 2.4.7** (issue #21, decision: unify on cursor pagination).

## 2.1.0

Baseline for this documentation set — the oldest version this changelog covers. Superseded by every version above; kept only as the starting point of the recorded history, not a claim about current status.

### Added
- Brand-parameterized API: `/api/leads?brand=cogmap|seyu`
- Single frontend pipeline page: `/sales/[brand]`
- Mobile-first kanban board with responsive vertical stack on narrow screens
- Pointer-based drag-and-drop with ghost preview, pointer-capture cleanup, and opacity cleanup
- Collapsible kanban columns with per-column expand/collapse controls
- Live kanban column lead counts in headers, e.g. `Discovered (258)`
- Country-based filter UI derived from lead data
- ICE/name sort controls with asc/desc for kanban and table view
- Table view simplified to Name, Score, Status for mobile readability
- Table view contrast fix: dark text on light background
- Detail modal full-screen behavior on mobile via `matchMedia`
- Header/filter wrapping for narrow viewports
- PWA manifest alignment with app start URL and scope
- Mobile/PWA layout fixes: `minHeight: 100dvh`, `overflow: auto`, wrapped controls
- Action feedback toasts for mutations in lead detail modal
- Shared retry utility for transient API failures
- Validation smoke tests via `npm run test:smoke`

### Changed
- Tenant filter defaults to `default` and includes legacy docs without `tenantId`
- Lead contacts are canonical; top-level contact fields are merged into `contacts[]` on write, then cleared from list/detail responses where possible
- Drag affordance enlarged; whole card participates in pointer drag flow
- Card selection state is cleaned up after drag end/cancel
- Won/Lost column headers use green/red header treatment

### Known Issues
- Full `next build` may OOM in limited local environments; use `tsc --noEmit` for type verification
- PWA pinch-zoom behavior is tightened but may still need further refinement
- Table view mobile density/readability may still need additional tuning
- Country filter population depends on lead `country` data; sample data may be missing populated values
- Test coverage is limited to validation smoke tests; API route tests remain TODO
