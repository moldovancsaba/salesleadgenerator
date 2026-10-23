# User Email Integration & 2-Way Sync Specification

**Issues:** #247, #248, #249, #270, #271, #272  
**Version:** 2.4.330  
**Date:** 2026-10-22  

---

## 1. Executive Summary

This specification defines the multi-user email integration architecture for Sales Lead Generator (SLG). It enables each sales representative to connect their individual Google / Gmail account via OAuth 2.0 PKCE, send 1:1 outreach emails directly from their personal mailbox via the Gmail REST API, and automatically synchronize bi-directional correspondence between leads and sales reps into the unified activity timeline, with automatic sequence cancellation upon human reply.

---

## 2. Problem Statement & Architecture Decision

### Why DoneIsBetter SSO Cannot Provide Gmail API Access
- DoneIsBetter SSO (`https://sso.doneisbetter.com`) provides OpenID Connect authentication (`openid profile email`), returning identity JWTs for SLG authentication.
- Google does not permit third-party SSO providers to grant or delegate Google API OAuth access tokens (`gmail.send`, `gmail.readonly`) to downstream applications.
- **Resolution**: SLG connects directly to Google OAuth 2.0 (`https://accounts.google.com/o/oauth2/v2/auth`) with PKCE (`S256`).

### Multi-User Extension to Existing Hub
- Issue #217 built a connection hub supporting one connection per `{brand, tenantId, provider}`.
- To enable individual user mailboxes, `IntegrationConnection` is extended with an optional `userId?: string` (storing `ssoUserId`) and `userEmail?: string`.
- Brand-level connections (e.g. public booking calendar) remain keyed by `{brand, tenantId, provider}` with `userId: null`.
- User-level connections (e.g. personal Gmail) are keyed by `{userId, provider}` (sparse index), allowing each sales rep to authenticate once and use their mailbox across all accessible brands.

---

## 3. Data Model & Storage

### `IntegrationConnection` Schema (`lib/integration-connections.ts`)
```typescript
export type IntegrationConnection = {
  id: string;
  brand: string;
  tenantId: string;
  provider: IntegrationProvider;
  authMethod: IntegrationAuthMethod;
  encryptedCredentials: EncryptedBlob; // AES-256-GCM encrypted tokens
  providerAccountLabel?: string;      // Display address, e.g. "rep@company.com"
  scopes?: string[];
  accessTokenExpiresAt?: string;
  connectedBy: string;                // ssoUserId
  connectedAt: string;
  lastVerifiedAt?: string;
  status: IntegrationStatus;          // 'active' | 'expired' | 'revoked' | 'error'
  lastSyncError?: string;
  updatedAt: string;
  revokedAt?: string | null;
  // User-level extension (Issue #247)
  userId?: string;                    // ssoUserId of owner rep (omitted for brand-level)
  userEmail?: string;                 // Authenticated Google account address
};
```

### MongoDB Indexing (`app/lib/integration-store.ts`)
1. `{ brand: 1, tenantId: 1, provider: 1 }` (sparse unique for brand connections where `userId` is null)
2. `{ userId: 1, provider: 1 }` (sparse unique for user-level connections)

---

## 4. Deliverables Breakdown

### Deliverable 1: User-Level Connection Hub & Settings UI (#247)
- **OAuth Connect Flow**: Support `scopeType=user` in `GET /api/integrations/[provider]/connect`.
- **OAuth Callback**: Query `https://gmail.googleapis.com/gmail/v1/users/me/profile` to capture authenticated email address, store `userId: claims.sub`.
- **API Surface**:
  - `GET /api/user/integrations`: Returns active integration connections for current session user.
  - `POST /api/user/integrations/[provider]/disconnect`: Revokes and marks connection revoked.
  - `POST /api/user/integrations/[provider]/test`: Verifies token against Google API.
- **UI**:
  - User Settings Modal accessible from navigation drawer (`AppNav.tsx`).
  - Displays Gmail connection state, authenticated email, "Connect with Google", "Disconnect", and "Test" buttons.

### Deliverable 2: Outbound 1:1 Email Sending via Gmail REST API (#248)
- **RFC 2822 MIME Builder** (`lib/gmail-send.ts`):
  - Formats standard email message with `From: Name <email>`, `To: Name <email>`, `Subject`, `Date`, `Message-ID`, `In-Reply-To`, `References`, and `Content-Type: text/plain; charset=UTF-8`.
  - Base64url-encodes MIME string without padding.
- **API Transport**:
  - `POST https://gmail.googleapis.com/gmail/v1/users/me/messages/send` with `{ raw: base64UrlData }`.
- **Outreach Send Dispatch** (`lib/outreach-send.ts` & `POST /api/outreach-send`):
  - Checks if sender has an active user Gmail connection via `getUserConnection(db, ssoUserId, 'gmail')`.
  - If connected: Dispatches via Gmail API, records `outreach_logs` (`source: 'gmail'`, `from: repEmail`), and writes `activity_logs` (`direction: 'outbound'`, `type: 'email-outbound'`).
  - If not connected: Falls back to brand Resend address (`resolveOutboundFromAddress()`).
- **Compose Modal** (`app/outreach/compose-modal.tsx`):
  - Displays active sender badge: *"Sending from rep@company.com (Gmail)"* or *"Sending from brand@haho.ai (Resend)"*.

### Deliverable 3: Multi-User 2-Way Inbound Gmail Sync Engine (#249)
- **Multi-Mailbox Ingestion** (`app/lib/gmail-sync-store.ts`):
  - Iterates over all active Gmail connections (both user-level and brand-level).
  - Fetches message metadata (`format=metadata`) with cursor tracking per `connectionId`.
- **Data Minimization Gate**:
  - Compares participant emails against `contactEmails` across active brands.
  - Non-lead personal emails are immediately skipped and never fetched into memory or persisted.
- **Direction & Lead Association**:
  - `from === userEmail` &rarr; `direction: 'outbound'` (logged as outbound touch).
  - `from !== userEmail` &rarr; `direction: 'inbound'` (prospect reply).
  - Runs `matchReplyToLeads()` to attach to lead timeline.
  - If human reply: cancels cadence sequence (`activeCadence: null`) and removes future Google Calendar task reminders.
  - Deduplication: RFC 2822 `Message-ID` (`gmail:<message-id>`) and fallback hash (`buildFallbackHash()`).

### Deliverable 4: On-Demand User Mailbox Sync & UI Controls
- **API Route** (`POST /api/user/integrations/[provider]/sync`):
  - Validates session user claims (`resolveSessionFromIdToken`).
  - Calls `pollUserGmail(db, userId, targetBrand)`.
  - Returns immediate sync results (`ingested`, `skipped`, `failure`).
- **UI Affordances** (`app/components/UserSettingsModal.tsx`):
  - "Sync Emails Now" button in User Settings Modal alongside Test and Disconnect.
  - Live feedback banner on messages ingested vs CRM contacts checked.

### Deliverable 5: Gmail SendAs Signature Synchronization (#241)
- **Signature Ingestion Engine** (`lib/gmail-signature.ts`):
  - Queries Google Gmail Settings API `GET https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs` using rep OAuth access token.
  - Selects primary sendAs configuration matching rep email address.
  - Sanitizes HTML content (`sanitizeSignatureHtml`) stripping scripts, iframes, and inline event handlers while preserving layout.
  - Generates plain text version (`signatureHtmlToText`) decoding HTML entities and collapsing excess newlines.
  - Formats appended email text using standard RFC 3676 delimiter (`\n\n-- \n${signatureText}`).
- **Synchronization Triggers & Storage**:
  - Automatic initial sync upon OAuth connection callback in `app/api/integrations/oauth/callback/route.ts`.
  - Self-service refresh API route `POST /api/user/integrations/gmail/signature/sync`.
  - Cached in `integration_connections` (`signatureHtml`, `signatureText`, `signatureSyncedAt`).
- **UI Affordances**:
  - `UserSettingsModal.tsx`: Displays signature preview card and "Refresh Signature" button.
  - `OutreachComposeModal.tsx`: Interactive toggle button ("Signature attached" / "No signature") defaulting to on for reps with connected Gmail.

### Deliverable 6: Threaded Email Follow-Ups & RFC 2822 Chaining (#243)
- **Threading Engine** (`lib/gmail-threading.ts`):
  - `resolveLeadThreadContext(db, leadId, brand, tenantId)`: Resolves previous email communication across `outreach_logs` and `activityLog`.
  - Normalizes subject line with standard single `Re: ` prefix (`formatReSubject`) preventing duplicate `Re: Re: ` chains.
  - Normalizes RFC 2822 `Message-ID` (`formatRfcMessageId`) with enclosing `<...>`.
- **MIME & REST Transport**:
  - Formats outbound MIME with `In-Reply-To` and `References` headers via `buildRfc2822Message`.
  - Passes Gmail API `threadId` to `POST https://gmail.googleapis.com/gmail/v1/users/me/messages/send` ensuring conversation grouping in recipient Gmail/Outlook clients.
  - Fallback subject: blank subject on follow-up steps is treated as "reply in thread", auto-resolving to `Re: <previous subject>`.
- **UI Affordances**:
  - `GET /api/leads/[id]/thread-context`: Endpoint providing thread context and availability to client.
  - `OutreachComposeModal.tsx`: Displays "↩ Reply in thread" / "New thread" toggle button when prior correspondence exists, auto-prefilling subject with `Re: <subject>` and chaining message headers.

### Deliverable 7: User Mailbox Isolation, Internal Domain Shield, and My vs Team Inbox (#268)
- **Database Sanitization & Contamination Remediation**:
  - Purged leaked internal bot logs, meeting notetakers (Fyxer, Gemini), and task management alerts (Asana) from `activityLog`.
  - Stripped internal team email addresses (`@seyuselfies.com`, `@cogmap.com`, `@dvsc.hu`, `@haho.ai`, etc.) mistakenly merged into prospect contact records.
  - Backfilled missing ownership attribution (`userId`, `userEmail`, `connectionId`) on prospect communications.
- **Systemic Internal Company Domain Shield**:
  - Defined canonical `INTERNAL_COMPANY_DOMAINS` in `lib/email-contact-extractor.ts`.
  - Hardened `isInternalOrSystemEmail()`: checks internal domains, brand prefixes, registered user emails, and automated bot / calendar platforms.
  - Hardened `mergeContactsIntoLead` (`lib/email-contact-merge.ts`): strictly filters out candidate contacts matching internal team domains before saving to leads.
- **Gmail Sync Minimization Hardening** (`app/lib/gmail-sync-store.ts`):
  - Strips internal company emails from `knownEmails` during brand and user Gmail polling, closing the loophole where having a colleague on a lead allowed personal emails to bypass data minimization.
  - Skips threads where all participants belong to the internal company team.
  - Attributes `userId`, `userEmail`, and `connectionId` on all ingested messages in `activityLog` with indexed lookups on `{ brand, userEmail, createdAt }` and `{ brand, userId, createdAt }`.
- **Unified Inbox Scoping & User Mailbox Isolation** (`app/lib/inbox-store.ts` & `app/inbox/[brand]/inbox-client.tsx`):
  - Computed thread ownership (`isMyInbox`, `userMailbox`) based on active user connections, message participants, and assigned leads.
  - Team Inbox is disabled per user directive: `/inbox/[brand]` and `GET /api/inbox/[brand]` strictly enforce user mailbox isolation (`scope: 'my'`), completely shielding other reps' mailboxes.
  - UI streamlines the conversation feed to the current representative's own synced correspondence and assigned leads, showing connected mailbox attribution chips without exposing team-wide mailbox toggles.

### Deliverable 8: Multi-Identity Mailbox Linking & Service Provider Shielding (#269)
- **Multi-Identity Mailbox Linking** (`app/lib/inbox-store.ts`):
  - Canonical user alias mapping (`KNOWN_USER_ALIASES`) linking personal Google SSO (`moldovancsaba@gmail.com`) with corporate Google Workspace accounts (`coo@seyuselfies.com`).
  - Automatically queries linked SSO records in `sso_user_access` and active Gmail integration connections across all alias accounts, unifying mailboxes under `userMailboxSet` and `userIds`.
  - Ensures seamless access to all personal and corporate communications when logged in under either identity.
- **Accounting & Service Provider Domain Shield**:
  - Added `reliableaccount.hu` (corporate accounting & payroll firm) to `INTERNAL_COMPANY_DOMAINS` in `lib/email-contact-extractor.ts`.
  - Hardened `isInternalOrSystemEmail` to shield against private VAT notifications (`áfa értesítő`) and payroll filings (`efo jelentések`).
- **Database Sanitization & Lead Decoupling**:
  - Purged 7 leaked accounting/internal activity logs from `activityLog` and cleaned associated thread states.
  - Decoupled contaminated foreign contacts from PSV Eindhoven (`6a57c08110cd2d62348d3309`), restoring clean club contacts (`s.jacobs@psv.nl` and Chairman Robert Van Der Wallen).
  - Backfilled attribution across 100% of activity logs in `activityLog` with valid `userEmail` and `userId`.

---

## 5. Legal, Regulatory & Google API Limited Use Compliance (#286)

### Google API Services User Data Policy & Limited Use Disclosure
Sales Lead Generator strictly complies with the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements:
1. **No AI/ML Training**: Google User Data (including message contents, headers, bodies, or attachments) is **never used to develop, train, fine-tune, or improve generalized artificial intelligence (AI) models, large language models (LLMs), or machine learning (ML) algorithms**.
2. **No Data Selling or Advertising**: Google User Data is never sold, rented, leased, or transferred to third-party brokers, nor used for serving any form of advertising (including targeted, retargeted, or interest-based ads).
3. **Restricted Sub-Processor Sharing**: Google User Data is transferred only to secure, SOC-2 compliant hosting providers (MongoDB Atlas for encrypted storage, Vercel for serverless execution) strictly as necessary to provide user-facing CRM features.
4. **Human Reading Prohibitions**: No human reads email message contents unless explicit user consent is granted for specific technical support instances, required for security/fraud investigations, or mandated by law.

### Mailbox Connection & User Consent Workflow
- Sales representatives connect their mailboxes voluntarily via the **My Account & Integrations** modal (`app/components/UserSettingsModal.tsx`).
- The authorization flow initiates via Google OAuth 2.0 with PKCE (`S256`) requesting minimal scopes:
  - `gmail.send`: 1:1 business outreach and sequence steps dispatched directly from the rep's mailbox.
  - `gmail.readonly`: Inbound reply synchronization restricted to CRM lead contacts.
  - `userinfo.email`: Identity resolution and sender account assignment.
- Disclosures and direct links to `/privacy` and `/terms` are presented directly within `UserSettingsModal.tsx`.

### Inbound Email Synchronization (Receiving Emails)
- **Data Minimization Gate**: Background sync inspects message metadata against registered CRM lead and contact email addresses. Emails not involving a known CRM contact are **immediately discarded without fetching or storing message contents**.
- **Internal Domain Shield**: Colleagues on `INTERNAL_COMPANY_DOMAINS` are shielded, preventing internal administrative or operational correspondence from polluting the CRM.
- **Fail-Closed Privacy Guard**: Reps only access their own synced correspondence. Unauthenticated or unresolved sessions return 0 threads.

### Outbound Email Dispatch (Sending Emails)
- Messages are dispatched directly via Google's official Gmail REST API (`POST https://gmail.googleapis.com/gmail/v1/users/me/messages/send`) using the rep's authenticated credentials, preserving SPF, DKIM, and DMARC integrity.
- Automated cadence sequences automatically terminate upon prospect reply to prevent redundant contact.
- Gmail SendAs signatures are synchronized and formatted with standard RFC 3676 delimiters (`-- `).

### Anti-Spam Obligations & Acceptable Use
- Users must comply with the CAN-SPAM Act, GDPR, and ePrivacy/PECR regulations.
- Truthful header information and non-misleading subject lines are strictly required.
- Reps must promptly honor opt-out and unsubscribe requests.

### Canonical Legal Documentation & Public Routes
- Canonical Privacy Policy: `docs/PRIVACY_POLICY.md` and public endpoint `/privacy` (`app/privacy/page.tsx`).
- Canonical Terms of Service: `docs/TERMS_OF_SERVICE.md` and public endpoint `/terms` (`app/terms/page.tsx`).

