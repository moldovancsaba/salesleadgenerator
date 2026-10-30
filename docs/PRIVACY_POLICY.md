# Privacy Policy — Sales Lead Generator

**Effective Date:** October 26, 2026  
**Last Updated:** October 26, 2026  
**Application Version:** 2.4.334  
**Hosting / Production:** https://sales.haho.ai (Legacy: https://salesleadgenerator.vercel.app)  

---

## 1. Introduction

Sales Lead Generator ("we", "us", "our", or "SLG") is a sales intelligence and customer relationship management (CRM) platform operated by Moldován Csaba Kft., designed to help commercial teams manage sales leads, track pipeline stages, coordinate business outreach, and streamline communications with organizational prospects.

This Privacy Policy explains how we collect, use, process, disclose, and safeguard your personal information when you use the Sales Lead Generator web application, APIs, and associated services (collectively, the "Service"). It also describes your rights regarding your data and explains how you can manage your privacy preferences.

We take privacy, data protection, and transparency seriously. If you have questions about this policy or our data practices, please contact us at `moldovancsaba@gmail.com`.

---

## 2. Google API Services User Data Policy & Limited Use Disclosure

Sales Lead Generator integrates with Google APIs (including the Gmail API, Google Calendar API, and Google People / Contacts API) to enable seamless email messaging, meeting scheduling, and contact management directly within the CRM.

### Google Limited Use Compliance Statement
> **Sales Lead Generator's use and transfer of information received from Google APIs to any other app will adhere to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements.**

In strict adherence to the Google API Services User Data Policy, we observe the following binding rules regarding all data obtained via Google APIs ("Google User Data"):

1. **No Artificial Intelligence / Machine Learning Model Training**:  
   We **do not** use Google User Data (including the raw text, headers, bodies, or attachments of emails accessed via the Gmail API) to develop, train, fine-tune, or improve generalized artificial intelligence (AI) models, large language models (LLMs), or machine learning (ML) algorithms. Any conversation intelligence or transcript parsing provided in the application operates strictly on user-initiated, local heuristic matching or ephemeral session processing, and never for general model training.
2. **No Selling or Commercial Transfer of Data**:  
   We **do not** sell, rent, lease, or monetize Google User Data to any third party, broker, or advertising network under any circumstances.
3. **No Advertising Use**:  
   We **do not** use or disclose Google User Data for serving advertisements, including personalized, retargeted, behavioral, or interest-based advertising.
4. **Strictly Limited Sharing**:  
   We only transfer Google User Data to third-party sub-processors (specifically our secure, encrypted cloud database provider, MongoDB Atlas, and application hosting platform, Vercel) as strictly necessary to provide and operate the core CRM user-facing features requested by you, to comply with applicable law, or as part of a bona fide corporate restructuring.
5. **Human Access Restrictions**:  
   No human beings at Sales Lead Generator read your Google User Data or email contents unless one of the following explicit conditions is met:
   - We have obtained your explicit, affirmative consent to view specific messages (for example, if you request technical support for a message display error);
   - It is strictly necessary for security purposes (such as investigating abuse, spam violations, software bugs, or security incidents);
   - It is required to comply with applicable law, regulation, legal process, or governmental request; or
   - The data is aggregated and anonymized for internal system performance monitoring where no personal identifiable information or message content is exposed.

---

## 3. Connecting Your Mailbox (Google / Gmail)

Sales Lead Generator provides native, multi-account Google integration so that sales representatives can send outreach directly from their own corporate or personal email addresses and receive prospect replies directly in the CRM.

### How to Add Your Mailbox:
1. Log into your Sales Lead Generator account.
2. Open the navigation menu (drawer on mobile/tablet or sidebar on desktop).
3. Click **"Email & Integrations"** (or click your profile name) to open the **My Account & Integrations** modal.
4. Under **"Personal Mailboxes (Google / Gmail)"**, review the connection permissions and click **"Connect with Google"** (or **"Add Another Account"**).
5. You will be redirected securely to Google's official OAuth 2.0 consent screen (`https://accounts.google.com`).
6. Review the requested permissions and click **Allow**.
7. Google will redirect you back to Sales Lead Generator with a cryptographically verified authorization code.
8. Your connected mailbox will appear under your active integrations, displaying your email address, verification status, and default sender controls.

### Scopes Requested & Functional Justification:
When connecting your Google account, Sales Lead Generator requests the minimum necessary permissions:
- `https://www.googleapis.com/auth/gmail.send`: Allows Sales Lead Generator to dispatch 1:1 business outreach emails and scheduled cadence sequence steps directly from your authenticated email address upon your command.
- `https://www.googleapis.com/auth/gmail.readonly`: Allows Sales Lead Generator to read and synchronize inbound email correspondence received from your CRM leads and contacts, displaying them on the lead activity timeline and in your personal Unified Inbox.
- `https://www.googleapis.com/auth/userinfo.email`: Allows the service to identify your Google email address and bind the integration connection to your user profile.
- `https://www.googleapis.com/auth/calendar.events` & `https://www.googleapis.com/auth/calendar.freebusy`: Allows the meeting scheduler to check your free/busy availability and automatically create calendar invitations with Google Meet conferencing links when a prospect books a meeting with you.
- `https://www.googleapis.com/auth/contacts.readonly`: Used only when you choose to import business contacts from Google Contacts into a CRM lead record.

---

## 4. How We Receive & Synchronize Emails (Inbound Sync)

Sales Lead Generator operates a 2-way email synchronization engine designed with strict **Data Minimization** and **Privacy Isolation**:

### Data Minimization Filter
- **CRM Contact Filtering**: When checking for new incoming emails, our sync engine fetches message headers and inspects sender and recipient addresses.
- **Strict Non-CRM Discard**: The sync engine compares participants against the known email addresses of leads and contacts in your active CRM brand. If an email thread is between you and a personal contact, non-CRM colleague, or external party not registered in your CRM leads, **the email is immediately skipped**. The body text, attachments, and contents of non-CRM emails are **never fetched, never processed, and never stored** in our database.

### Systemic Internal Domain Shielding
- To prevent private internal company discussions (such as internal team syncs, payroll notices, HR communications, or automated calendar bot summaries) from polluting sales records, Sales Lead Generator maintains an enforced `INTERNAL_COMPANY_DOMAINS` filter.
- Internal emails between colleagues within your organization are excluded from lead contact creation and prospect inbox feeds.

### User Mailbox Isolation & Fail-Closed Security
- **Personal Mailbox Scoping**: By default, each sales representative only sees emails sent to or received from their own connected mailboxes or assigned leads. Reps cannot browse or inspect other team members' private correspondence.
- **Fail-Closed Guard**: If an authenticated session cannot verify or resolve the user's active permissions, the inbox interface strictly fails closed, returning zero threads to prevent any accidental cross-user data leakage.

---

## 5. How We Send Emails via Our Service (Outbound Sending)

When you send an email or launch a sales cadence in Sales Lead Generator:
- **Direct Dispatch via Gmail API**: If you have connected your Google account, outbound emails are transmitted directly through Google's official Gmail REST API (`POST https://gmail.googleapis.com/gmail/v1/users/me/messages/send`) using your authenticated account. The email originates from your genuine mailbox, with standard DKIM, SPF, and DMARC authentication provided by your Google Workspace or Gmail domain.
- **System Fallback (Resend)**: If you have not connected a personal Google account, outreach is sent via the brand's verified notification domain (via Resend) using a designated corporate sender address.
- **RFC 2822 Conversation Threading**: Follow-up emails sent from the CRM automatically include standard `In-Reply-To` and `References` headers matching prior messages in the thread, ensuring that conversations appear grouped in your prospect's email client.
- **Gmail SendAs Signature Integration**: The application can synchronize your primary Gmail signature (`sendAs` settings), automatically formatting and appending your approved business signature using standard RFC 3676 delimiters (`-- `).
- **Automatic Cadence Cancellation upon Reply**: If a prospect replies to an outreach email, our inbound sync engine immediately detects the reply, marks the lead as responded, cancels any pending automated sequence steps (`activeCadence: null`), and clears automated reminders.

---

## 6. Information We Collect

In addition to Google User Data, we collect:
1. **Account & Authentication Information**: When you log in via DoneIsBetter Single Sign-On (SSO) or Google OAuth, we receive your name, email address, unique SSO user identifier (`ssoUserId`), and assigned organization roles (`admin`, `user`).
2. **CRM Business Data**: Information entered into lead records, including organization names, website URLs, industry categories, business regions, deal estimates, notes, contact names, business email addresses, and phone numbers.
3. **Activity Logs**: Timestamps, action types (e.g., stage movements, call logs, notes, quote generation), and IP addresses for audit and security logging.
4. **Integration Credentials**: OAuth refresh tokens, access tokens, and integration status flags. All OAuth credentials and secrets are encrypted with AES-256-GCM before storage.

---

## 7. Data Security & Storage

We employ enterprise-grade administrative, technical, and physical safeguards:
- **Encryption at Rest**: All sensitive credentials, including Google OAuth access tokens and refresh tokens, are encrypted at rest using **AES-256-GCM** authenticated encryption with unique cryptographic nonces before being written to our database.
- **Encryption in Transit**: All communications between your browser, our servers, Google APIs, and third-party services are transmitted exclusively over encrypted **HTTPS / TLS 1.3** channels.
- **Isolated Multi-Tenant Access**: Database records are logically partitioned by brand (`cogmap`, `seyu`, `dvsc`) and tenant ID, enforced at the API route and query layer.
- **Ephemeral Session Tokens**: User sessions use secure, `httpOnly`, `SameSite=Lax`, cryptographically signed JWT cookies with short expiration windows.

---

## 8. Data Retention, Disconnection & Deletion

### How to Disconnect Your Mailbox:
You can disconnect your Google account and revoke Sales Lead Generator's access at any time:
1. In the app, navigate to **"Email & Integrations"** in the navigation menu.
2. Next to your connected account, click **"Disconnect"**.
3. Confirm the prompt. The server immediately revokes the token with Google (`https://oauth2.googleapis.com/revoke`), deletes the encrypted credentials from active storage, and halts all background synchronization for that account.
4. You may also revoke access directly from your Google Account management portal at any time by visiting [Google Account Permissions](https://myaccount.google.com/permissions).

### Data Retention & Account Deletion:
- We retain CRM records and associated activity logs only for as long as your organization maintains an active account with us or as required by law.
- If you or your organization administrator requests account deletion, all associated user data, lead notes, synchronized activity records, and encrypted integration credentials will be permanently purged from our primary database within 30 days.

---

## 9. Your Rights (GDPR & CCPA/CPRA Compliance)

Depending on your location, you may have statutory rights regarding your personal data:
- **Right to Access / Know**: You may request confirmation of whether we process your data and obtain a copy of the personal information we hold about you.
- **Right to Rectification**: You may request correction of inaccurate or incomplete personal data.
- **Right to Erasure ("Right to be Forgotten")**: You may request that we delete your personal information, subject to legal compliance obligations.
- **Right to Restrict or Object to Processing**: You may object to the processing of your data or request that we restrict processing in certain circumstances.
- **Right to Data Portability**: You may request your data in a structured, commonly used, machine-readable format (e.g., CSV or JSON export).
- **Non-Discrimination**: We will not discriminate against you for exercising any of your privacy rights.

To exercise any of these rights, please contact our privacy team at `moldovancsaba@gmail.com`. We respond to verified requests within thirty (30) days.

---

## 10. Third-Party Sub-Processors

We work with reputable, SOC-2 compliant infrastructure providers to host and deliver the Service:
- **MongoDB Atlas** (Database hosting, AES-256 encrypted storage)
- **Vercel Inc.** (Application hosting and serverless API execution)
- **Google LLC** (Gmail, Google Calendar, Google Contacts API services)
- **Resend Inc.** (System notification email delivery)
- **DoneIsBetter SSO** (Identity authentication and OpenID Connect)

---

## 11. Changes to this Privacy Policy

We may update this Privacy Policy from time to time to reflect changes in our legal obligations, features, or data processing practices. When updates are published, we will revise the "Last Updated" date at the top of this page. If we make material changes to how we handle personal data or Google User Data, we will provide prominent notice within the application or via email.

---

## 12. Contact Us

If you have questions, concerns, or requests regarding this Privacy Policy or our data practices, please reach out to:

**Legal & Compliance Team**  
Legal entity: Moldován Csaba Kft.  
Email: `moldovancsaba@gmail.com`  
Website: https://salesleadgenerator.vercel.app  
Address: Budapest, Hungary