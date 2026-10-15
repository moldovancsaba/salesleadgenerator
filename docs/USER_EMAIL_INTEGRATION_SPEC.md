# User Email Integration & 2-Way Sync Specification

**Issues:** #247, #248, #249  
**Version:** 2.4.269  
**Date:** 2026-10-14  

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

