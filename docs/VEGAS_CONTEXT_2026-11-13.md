# Vegas client context — 13 November 2026

Research snapshot for the next Vegas update. Vegas is a client workspace inside Sales Lead Generator (SLG), not a separate application or Vercel project. No production configuration, campaign content, leads, scanner settings or credentials were changed during this review. The sections below preserve the pre-update research snapshot; the dated addendum records the later live change and code alignment in 2.4.376.

## Verified source and deployment

- Repository: https://github.com/moldovancsaba/salesleadgenerator (GitHub currently reports PUBLIC visibility).
- The workspace was initially empty; the repository was cloned into `/Users/Shared/Projects/salesleadgenerator`.
- Branch: `main`; source HEAD and deployed SHA both `833ca0f4d65aee16f076aec09509ac4d7ca32682`.
- Current package / README version: **2.4.375**.
- Latest source commit: 11 November 2026, 16:07:28 Europe/Budapest, “Vegas for the event collects leads only: no attendee pass, no pass email” (#337).
- Production deployment created: 11 November 2026, 16:07:33 Europe/Budapest; Vercel state `READY`.
- Vercel team: `narimato`; project: `salesleadgenerator`; project ID: `prj_5v09WffZ931SLne4NYphlbsY67io`.
- Deployment ID: `dpl_AVFj3YaWxAgGgJUVBW6wXyU7ur8p`.
- Deployment URL: https://salesleadgenerator-cqo9p4prb-narimato.vercel.app
- Canonical production: https://sales.haho.ai
- Other aliases: `salesleadgenerator.vercel.app`, `salesleadgenerator-narimato.vercel.app`, `salesleadgenerator-git-main-narimato.vercel.app`.
- Vercel Git integration points to `moldovancsaba/salesleadgenerator`, production branch `main`, root `.`. Framework Next.js; Node 24.x; basic build machine, 2 vCPU / 8 GB; inspected functions in `iad1`.
- Deployment protection: `all_except_custom_domains`; Git fork protection enabled.
- Open GitHub issues and open PRs: none returned at review time. Recent Vegas issues #328–#337 are closed (not every issue in that numeric interval is Vegas-specific).
- The similarly named `salesleadgenerator-crm` repository describes a predecessor Vega CRM snapshot. It is not the Vegas client.

## Application map

SLG is a multi-client CRM with runtime-editable brands, brand-specific lead collections, SSO workspace access and MongoDB persistence. It includes pipeline boards/tables/backlog, Today tasks, contacts/accounts, inbox, Gmail/Calendar integrations, outreach/cadences, products, quotes, forecasts, reports, automation, imports/exports and landing page lead collection.

Declared stack: Next.js `^16.3.6`, React `^19.2.8`, Mantine `^9.4.2`, GDS packages `^6.8.0`, MongoDB driver `^6.20.0`, TypeScript `^6.0.3`, Vitest `^4.1.11`; these are manifest ranges, not a fresh dependency audit. Styling uses Mantine/GDS and CSS; Tailwind is not installed.

Important references: `AGENTS.md`, `HANDOVER.md`, `README.md`, `CHANGELOG.md`, `roadmap.md`, `docs/ARCHITECTURE.md`, `docs/LLD.md`, `docs/LANDING_PAGE_BUILDER_GUIDE.md`, `docs/LESSONS_LEARNED.md`.

## Vegas workspace identity and seed settings

The following values come from source seed configuration, **not a read of the current private database**:

- Slug `vegas`; fallback display label `Vegas`; client branding Mr Vegas.
- Lead collection `vegas_leads` (some handover examples/tests use `leads_vegas`; the actual fallback constant is `vegas_leads`).
- Aliases: `vegas`, `mrvegas`, `mr-vegas`, `vegassales`, `mrvegassales`.
- Currency EUR; forecast model `dealSizeBand`; configured sender `office@mrvegas.com`.
- `scripts/onboard-vegas.ts` seeds `brands`, `company_settings`, `products`, and `sso_user_access`, granting the owner admin access. It supports dry-run / `--apply`; it was not run during this review.
- Seed company: Mr Vegas (Grand Slam of Darts Partner), website https://www.mrvegas.com; industry Sports Sponsorship & Tournament Lead Acquisition.
- Seed customer types: sports fans, event attendees, tournament guests, hospitality VIP, sponsorship partners, darts enthusiasts, corporate hospitality.
- Seed buyer roles: event participant, VIP guest, hospitality buyer, marketing director, corporate sponsor.
- Seed deal bands: small 500, medium 2,500, large 12,000, enterprise 50,000; largest won 35,000. Seed annual revenue target EUR 250,000. Q4 / November seasonality.
- Three seed catalog products: fan acquisition / ticket giveaway (500), VIP hospitality (2,500), corporate hospitality / sponsor activation (15,000), one-time EUR prices. Their descriptions still reflect the initial giveaway framing.
- Mongo `brands` becomes authoritative once populated; changing fallback constants does not update an existing live brand. Likewise, rerunning onboarding with `--apply` can overwrite current settings and is not an appropriate content-edit operation.

## Live campaign — verified from production HTTP response

- Public page: https://sales.haho.ai/landing/vegas/grand-slam-of-darts (HTTP 200).
- `/landing/vegas` redirects to this campaign in source.
- Stored campaign ID `6af441059679ab3afa2b2033`; brand `vegas`; tenant `default`; slug `grand-slam-of-darts`; published true.
- Stored `updatedAt`: `2026-11-11T16:59:46.834Z` (17:59:46.834 Europe/Budapest), later than the code deployment.
- Stored creation timestamp `2026-11-06T18:00:00.000Z`.
- Title: “Win Tickets to the Mr Vegas Grand Slam of Darts”. Description still describes a ticket giveaway.
- Visible headline “Hi Darts Fans,”; welcome “Welcome to The Mr Vegas Grand Slam of Darts!”
- Actual offer: register to play the Mr Vegas Bullseye Challenge; hit a bullseye from three darts to win a drinks token and enter a free draw for a signed dartboard and a Mr Vegas bonus.
- Banner `/landing/vegas/mr-vegas-grand-slam.jpg`; aspect ratio `1200/1181`; theme `dark_emerald`.
- Event: Mr Vegas Grand Slam of Darts; WV Active Aldersley, Wolverhampton; date text November 2026. No exact event end date was established by this review.
- CTA “Submit Entry”. Success title “Thank You for Entering!”; success text points to PDC social channels/news/competitions.
- Live blocks: hero banner/copy/bullets/footer on; terms modal off; digital passes **off**; calendar toggle **on**.
- Important drift: the code default has both digital passes and calendar off; HANDOVER says both are off. The live stored calendar toggle is on. The calendar button is inside the digital-pass section and pass generation exits early when passes are off, so this does not currently expose a calendar download. Do not silently normalize the record during a research task.
- `termsHtml` empty; footer disclaimer plain text, including “privacy policy” without a link.
- Public payload contains no `scanner` settings. Full scanner configuration cannot be inferred from this projection.

### Current live form

| Field | Required | Mapping |
| --- | --- | --- |
| First Name | Yes | `contact_first_name` → `firstName` |
| Last Name | No | `contact_last_name` → `lastName` |
| Country | Yes | `country` |
| Post Code | Yes | `post_code` → `postCode` |
| Date of Birth | Yes | `date_of_birth` → `dateOfBirth` |
| Phone Number | No | `contact_phone` → `contactPhone` |
| Contact Email | Yes | `contact_email` → `contactEmail` |
| Mr Vegas marketing Yes/No | No | `custom_radio_choice` → `consentMrVegas` |

The marketing field has options `Yes` / `No` and default value `no`. The earlier PDC checkbox is absent. The DOB hint says “YYYY-MM-DD (18+ only)”; the inspected server validator only trims/preserves DOB and the date input has no age limit. Age enforcement is therefore not established by that hint; source inspection found no age check in this path. No underage or other test submission was sent.

## Lead capture and edit paths

- Editor: https://sales.haho.ai/outreach/landing-pages/vegas
- Sales settings: https://sales.haho.ai/salessettings/vegas ; products `?tab=products`.
- Today: `/today/vegas`; other client surfaces use the `vegas` brand route parameter.
- Campaigns live in Mongo `landing_pages`, uniquely indexed by brand/slug/tenant. A stored record takes precedence over `DEFAULT_VEGAS_CAMPAIGN`.
- Content and switch changes normally use the authenticated editor without a Vercel rebuild. `GET/POST /api/landing-pages?brand=vegas`; `PUT /api/landing-pages/<id>?brand=vegas` for updates.
- Visitor submissions post to `/api/forms/vegas/submit`, tenant `default`; browser maps configurable fields to the generic submission payload and adds UTM values to `dynamicFields`.
- Server validates name/email, normalizes country/region/website, applies IP/brand rate limiting, and silently accepts honeypot hits without creating a lead.
- Deduplication searches the client's lead collection by fingerprint or contact email. New records start at `DISCOVERED`, source `landing_grand-slam-of-darts`, campaign/tag `grand-slam-of-darts`, with contacts, score, follow-up, and DOB/consent/dynamic fields under `extraFields` and notes.
- Repeat submissions merge contacts, append an inquiry note and refresh follow-up. This branch does not refresh the original campaign/consent/DOB `extraFields`; assess explicitly if repeat-entry data matters in the requested update.
- New records trigger automation/webhook evaluation; an inbound activity note is recorded. Pass email is gated by the stored campaign's `showDigitalPasses`, currently false.
- The live public payload returned `viewsCount: 159`, `submissionsCount: 0` during this review. These are snapshot counters, **not authoritative lead totals**. `incrementLandingPageSubmission` exists only as a definition, with no callers found in tracked TS/TSX; the submission handler never increments the campaign counter. A page read also increments views.
- No live form submission, check-in, email, campaign save or data mutation was performed to test this path.

## Scanner and passes

- Reader route `/landing/vegas/grand-slam-of-darts/qrreader`; scan endpoint `/api/landing/vegas/grand-slam-of-darts/hostess-scan`.
- Source default / handover describe scanner enabled, target `ENGAGED`, tags `hostess-contacted` and `card-accepted`, walk-in creation allowed. These scanner settings were not verified against the private stored record.
- Code checks the access code server-side, rejects non-attendee QR data, identifies contacts by email/phone/name, advances stages only forward, records repeated scans, automation/webhook outcomes and check-in activity.
- Reader keeps the camera open, decodes scaled frames, displays results over the camera, supports torch and wake lock where the phone/browser allow it. Handover records an owner phone check on 11 November; this review did not retest hardware.
- Visitor page uses `toPublicLandingPage`; reader uses `toPublicScannerConfig`. Never serialize the entire server record to a browser.
- Shared pass modules: `lib/attendee-card.ts`, `lib/apple-wallet.ts`, `lib/google-wallet.ts`, `lib/landing-confirmation-email.ts`; routes `/api/badge`, `/api/wallet/pass`.
- Existing code/default and handover identify an access code exposure through the source default and optional reader hint. No access code is reproduced here. Passes being disabled does not itself disable the scanner.

## Recent updates relevant to Vegas

| Date | Change |
| --- | --- |
| 6 Nov | #328: Vegas client onboarding and initial campaign collector, version 2.4.369. |
| 7 Nov | #329: dynamic landing page editor / property mapping, version 2.4.370. |
| 9 Nov | #330–#333: hostess scanner, QR improvements, Apple Wallet engine, pass confirmation email, modular blocks/editor. |
| 11 Nov | #334: Bullseye Challenge copy; complete banner at its own proportions; remove invalid terms links and PDC opt-in checkbox. |
| 11 Nov | #335: rebuild unstyled reader in Mantine, continuous scan loop, badge validation, repeat scan feedback. |
| 11 Nov | #336: scanner/event settings become reusable per-page features; fix visitor payload leaking scanner access-code configuration. |
| 11 Nov | 2.4.373: Safari wheel/trackpad scrolling fixed by removing vertical `overscroll-behavior: none` from root elements. |
| 11 Nov | 2.4.374: invalid nested paragraph in DOB hint fixed, resolving React hydration error 418. |
| 11 Nov | 2.4.375 / #337: lead collection only; no badge/QR/wallet/contact-card/calendar download or pass email when passes off. |

Use commit history plus current code as release evidence: some roadmap version labels are inconsistent with the changelog. HANDOVER's opening version is 2.4.372, behind the actual 2.4.375 package/README.

## Vercel runtime configuration inventory

Environment metadata was inspected without printing or saving secret values. Presence does not prove credential validity or connected-account health.

- Production names present: `MONGODB_URI`, `SLG_API_KEY`, `CRON_SECRET`, SSO base/client/secret/redirect/super-admin settings, Google OAuth client/secret/redirect, `INTEGRATION_CREDENTIALS_ENCRYPTION_KEY`, `GITHUB_TOKEN`, `APP_URL`, `NEXT_PUBLIC_SITE_URL`, `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, and five Apple Wallet certificate/key/identifier variables.
- Apple Wallet variables also have development entries. Several SSO/OAuth/encryption/GitHub settings have preview entries; MongoDB and SLG API key were listed for production only.
- No Google Wallet issuer/service-account/private-key variable names (including supported aliases), `BLOB_READ_WRITE_TOKEN`, `HOSTESS_SCAN_PASSWORD`, or authority provisioning variables were returned by the project environment list. This is a metadata inventory, not an exhaustive check of all external integrations. Code returns null from Google Wallet signing without its credentials.
- README's statements that Resend keys are not configured are stale: their production entries were verified present.
- Seven enabled deployed crons match `vercel.json`: Monday forecast 06:00 UTC and ticket-size recalculation 07:00 UTC; daily cadence 08:00 UTC and automation 09:00 UTC; hourly reports, Gmail sync and webhook delivery. Execution success was not audited.

## Constraints and follow-up context

- HANDOVER records the owner's 11 November instruction to keep Vegas as it is until after the event and clean it up afterward. The user's current request is information collection; it does not specify a new page change or revoke that constraint.
- Recorded post-event items: rotate scanner access code and disable its hint; align title/description with Bullseye Challenge; obtain a valid client privacy URL; generalize consent field naming; expand real-phone scanner coverage.
- Additional findings for scoping: live calendar/default drift; unused submission counter; DOB hint without age enforcement; repeat-submission metadata retention. These are research findings, not fixes performed here.
- Shared store fields must be preserved in all three mappers (list/read/save). Block switches were previously lost because one mapper omitted them.
- Before shipping a code change, follow `AGENTS.md`: issue-driven substantial work, documentation, typecheck/lint/unit/smoke quality gates and relevant integration/build/style checks; preserve client isolation. Review actual test output rather than treating the previous handover's passing suite as a current run.

## Access and verification limits

Authenticated Vercel project/deployment/environment metadata and GitHub history/issues were available. Public production campaign content was fetched and matched to source behavior. Anonymous reads of campaign administration, sales settings and leads each returned HTTP 401 (`Not authenticated`).

This review did **not** retrieve private lead counts/records, stored sales settings/catalog/access grants, all private campaigns, current scanner secret/settings, account integration health, runtime error logs or successful cron executions. Seed values above must not be presented as a current database export. No secrets were decrypted for this research. Application tests were not run because no application code changed; deployment READY is not proof of an end-to-end submission or camera test.


## Addendum — client-approved live copy update and 2.4.376

On 13 November the owner requested the specific promotion and result wording below, superseding the freeze for these text edits only. The authenticated landing page editor saved campaign `6af441059679ab3afa2b2033`; production subsequently returned `updatedAt: 2026-11-13T08:45:09.668Z` (09:45:09.668 Europe/Budapest).

The opening registration sentence and “Good Luck!” remain. The offer paragraph is now:

> Simply hit a Bullseye from 3 darts to win a drinks token from one of Mr Vegas Team managing the promotion fan zone game and then everyone who plays will be automatically entered into a free prize draw to win a signed dart board by the players and a bonus courtesy of Mr Vegas.

The added notice is:

> You must be 18 and over to participate in the Mr Vegas Bullseye Challenge.

The result title is “Thank you for entering!” and its message is:

> Have a brilliant night at The Mr Vegas Grand Slam of Darts and look out for an email from us very soon.

All other content, fields, block switches and scanner settings were preserved. In particular digital passes remain off, which still suppresses the immediate pass email; the wording about a later email does not turn on an email workflow. The age sentence is copy only, not an age validation change. Unrelated post-event clean-up remains deferred.

Verification: the editor reported “Saved” / “Landing page published instantly to MongoDB without rebuild!”; the public page rendered the exact promotion and 18+ notice; an independent HTTP read found the exact offer, notice, success title and success message in the server-rendered page payload, with `showDigitalPasses: false`. No lead or email was created for verification. Screenshot: `docs/vegas-live-2026-11-13.png`. Exact change receipt: `docs/vegas-copy-update-2026-11-13.json`.

Version 2.4.376 aligns only the fallback campaign copy with this saved record. It does not migrate or overwrite any stored page, including the existing live calendar-toggle difference.

Rollback: revert the 2.4.376 copy change for future/default campaigns. For the stored live record, separately restore the previous offer paragraph and success title/message in Content & Copy and remove the added age notice; preserve every other field and switch. The old wording is documented in the pre-update snapshot and the preceding source revision. Reverting source alone does not revert the saved campaign.


### Release validation — 2.4.376

The existing automated copy assertion was updated to the client-approved wording. No new dependency was added; package and lockfile version metadata are aligned.

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | Pass, no errors. |
| `npm run lint` | Pass, no errors or warnings. |
| `npx vitest run` | Pass, 186 files / 1,887 tests. |
| `npm run test:smoke` | Pass, 5 tests. |
| `npm run build` | Pass, compiled and generated production output. |
| `npm run test:integration` | 614 passed, 3 failed across 57 files; all three failures reproduced in the unchanged-main source checkout. |
| `npm run audit:gds-style` | 16 existing forbidden-color findings; normalized file/message lists exactly match the unchanged-main audit. Manifest validation passes. |
| `git diff --check` | Pass. |

Commands ran with temporary npm 11 tooling through `pnpm dlx npm@11` because this host provides Node and pnpm but no standalone npm command. This does not change project dependencies or registry settings. The default required gate (typecheck, lint, default unit suite and smoke) is clean. The integration suite is separately configured and excluded from the default unit gate; the previously documented style debt remains. No claim is made that every broader check passes.

Tracked independently from the copy update:

- [#338](https://github.com/moldovancsaba/salesleadgenerator/issues/338): two empty-registry integration expectations still list three brands instead of the six current fallback brands (`tests/integration/brand.integration.test.ts:62`, `tests/integration/admin-clients.integration.test.ts:74`).
- [#339](https://github.com/moldovancsaba/salesleadgenerator/issues/339): representative outreach CC-copy test records `inbound` rather than expected `outbound` (`tests/integration/inbound-email-webhook.integration.test.ts:397`). Cause and intended behavior still require investigation.
- [#340](https://github.com/moldovancsaba/salesleadgenerator/issues/340): the pre-existing GDS forbidden-color findings, enumerated below. No styling literal changed in this release.

- `app/api/badge/route.ts`
- `app/landing/[brand]/[campaign]/dynamic-landing-client.tsx`
- `app/landing/[brand]/[campaign]/qrreader/hostess-qr-reader-client.tsx`
- `app/outreach/landing-pages/[brand]/landing-pages-client.tsx`
- `lib/apple-wallet.ts`
- `lib/attendee-card.ts`
- `lib/landing-confirmation-email.ts`
- `lib/landing-page-schema.ts`
- `tests/lib/battlecards-ux.test.ts`
- `tests/lib/contacts-accounts-ux.test.ts`
- `tests/lib/docs-ui-consistency.test.ts`
- `tests/lib/forecast-segmented-tabs.test.ts`
- `tests/lib/integrations-ux.test.ts`
- `tests/lib/kanban-card-ux.test.ts`
- `tests/lib/landing-page-editor.test.ts`
- `tests/lib/outreach-ux-ergonomics.test.ts`


## Resolution — 2.4.377

The three integration failures and 16 style findings reported above are resolved in issues 338–340. All 617 integration tests and both GDS checks now pass, alongside the standard quality gate. The webhook failure came from shared test data, not a demonstrated production routing defect. See [the remediation record](VALIDATION_REMEDIATION_2026-11-13.md) for diagnosis, rendering comparisons, complete check results and rollback. The earlier findings and counts remain above as a historical baseline.
