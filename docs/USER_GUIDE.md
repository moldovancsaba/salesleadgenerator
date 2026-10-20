# User Guide — Sales Lead Generator

**Version:** 2.4.307  
**Application URL:** https://salesleadgenerator.vercel.app  

Welcome to **Sales Lead Generator**, an intelligent, multi-brand CRM and sales execution platform designed for B2B sports business, corporate partnerships, and outbound pipeline operations. This guide walks you through daily workflows, lead management, communication, and pipeline tools.

---

## Table of Contents

1. [Getting Started & Brand Navigation](#1-getting-started--brand-navigation)
2. [Today Workbench — Daily Execution](#2-today-workbench--daily-execution)
3. [Pipeline Kanban Board & Card Architecture](#3-pipeline-kanban-board--card-architecture)
4. [Drag-and-Drop, Stage Gates & Reordering](#4-drag-and-drop-stage-gates--reordering)
5. [Multi-CRM Exchange (HubSpot, Salesforce, Pipedrive, Google Sheets)](#5-multi-crm-exchange)
6. [Unified Communication Center (Inbox)](#6-unified-communication-center-inbox)
7. [Email Contact Conversion & Multi-Company Harvesting](#7-email-contact-conversion--multi-company-harvesting)
8. [Lead Detail, Contacts & Buying Committee](#8-lead-detail-contacts--buying-committee)
9. [Sequences, Cadences & Outreach Templates](#9-sequences-cadences--outreach-templates)
10. [CPQ Quotes & PDF Generation](#10-cpq-quotes--pdf-generation)
11. [Reports, Analytics & Forecast Projections](#11-reports-analytics--forecast-projections)
12. [Accounts Directory & Company Hierarchy](#12-accounts-directory--company-hierarchy)
13. [PWA Offline Support & Command Palette](#13-pwa-offline-support--command-palette)

---

## 1. Getting Started & Brand Navigation

### Signing In
Sales Lead Generator uses DoneIsBetter Single Sign-On (SSO). Click **Sign in** to authenticate with your organization credentials. Access is provisioned per brand by your administrator:
- **CogMap**: Cognitive mapping and sports analytics solutions.
- **Seyu**: Fan engagement, digital activations, and stadium technology.
- **DVSC**: Club partnerships, academy scouting, and team operations.

### Navigation Layout
- **Desktop & Tablet (`>= 768px`)**: A docked, collapsible sidebar navigation sits on the left edge. Use the **Hide / Show Navigation** toggle to collapse the sidebar when you want maximum screen space.
- **Mobile (`< 768px`)**: Tap the hamburger menu (☰) in the top bar to open the navigation drawer.
- **Brand Switcher**: If you have access to multiple brands, use the brand dropdown at the top of the sidebar to switch workspaces instantly.
- **Full-Width Workspace**: All tables, boards, and inboxes expand to 100% display width for maximum data scannability.

---

## 2. Today Workbench — Daily Execution

Navigate to `/today/[brand]` for your high-priority daily execution cockpit. Today aggregates time-sensitive actions across four prioritized queues:

1. **Cadence Tasks**: Scheduled manual sequence tasks (`Call`, `LinkedIn`, `Task`) waiting for your execution. Completing the task unlocks automated sequence progression.
2. **Overdue Follow-ups**: Follow-up commitments that were scheduled for prior calendar days (highlighted with red urgency badges displaying days overdue).
3. **Due Today**: Scheduled follow-up commitments due in today's calendar window (highlighted with amber badges).
4. **Deals Needing Attention**: Active pipeline deals that have exceeded their expected close date or have had no recorded activity for 7+ days.

### 1-Click Inline Actions
- **Complete Step**: For cadence tasks, records task completion (`completed_at`), logs an audit entry in the activity timeline, and advances the sequence to the next scheduled step.
- **Mark Done**: Clears the scheduled commitment and logs an activity record.
- **Snooze**: Postpones a follow-up commitment by 1 day, 3 days, 1 week, or a custom date.
- **Log Call**: Opens the call disposition modal directly to record call outcomes (`connected`, `voicemail`, `busy`, `no-answer`).
- **My Work / All**: Toggle at the top of the page to switch between your assigned leads and the entire team's queue.

---

## 3. Pipeline Kanban Board & Card Architecture

Navigate to `/sales/[brand]` to view your active sales pipeline.

### Pipeline Stages
- **DISCOVERED & QUALIFIED (Auto-Managed)**: Inbound and agent-discovered leads are scored automatically via ICE (Impact, Confidence, Ease). Leads with an ICE score of 500+ land in `QUALIFIED`; others land in `DISCOVERED`. Both columns sort automatically from highest to lowest score.
- **CONTACTED, IN_PIPELINE, PROPOSAL, NEGOTIATING**: Active pipeline stages managed manually by reps.
- **WON & LOST**: Terminal stages recording closed revenue or reasons for decline.
- **BACKLOG**: A dedicated holding area for postponed, out-of-season, or unassigned prospects.

### Card Visual Anatomy
Each card is engineered for immediate scannability:
1. **Full-Width Entity Title**: Organization names display with 2-line wrapping (`WebkitLineClamp: 2`), ensuring long names never truncate prematurely. Hovering over the title displays the full name in a tooltip.
2. **Sector Subtitle**: Muted Title Case subtitle (e.g., `Sports Club · Media Broadcaster`) provides instant industry context.
3. **Primary Contact Row**: Prominently highlights the key decision maker or contact (`👤 Paolo Maldini · Technical Director`). If unassigned, a quiet `+ Contact` button allows 1-click contact assignment.
4. **Quick Outreach (`IconMail`)**: A 1-click email button next to the contact opens your default mail client or in-thread composer to initiate outreach instantly without opening the drawer.
5. **Commercial Value Pill**: Displays active deal value (bold grape badge) or estimated ticket size (teal badge).
6. **Urgency & Due Date Badges**:
   - Overdue tasks display a high-visibility red badge (`3d overdue`).
   - Items due today display an amber badge (`Due today`).
   - Touch age indicators (`• 4d`) show freshness; zero-day touch alerts are suppressed to keep fresh cards clean.
7. **Deal Owner Avatar**: Displays the assigned owner's initials avatar chip and full un-truncated name.

### Stage-Aware Semantic Actions
- **In Review Stages (`DISCOVERED`, `QUALIFIED`)**:
  - **Accept** (`color="teal"`, checkmark icon): 1-click qualification confirming the lead for outreach.
  - **Decline** (`color="red"`, dismiss icon): 1-click rejection prompting for decline reason.
- **In Pipeline Stages (`CONTACTED`, `IN_PIPELINE`, etc.)**:
  - **Email** (`color="indigo"`, mail icon): 1-click quick outreach action.
- **Open**: Subtle `Open ↗` button opens the comprehensive Lead Detail drawer. Clicking anywhere on the card surface also opens the drawer.

---

## 4. Drag-and-Drop, Stage Gates & Reordering

- **Moving Stages**: Drag a card horizontally from one column to another. Real-time stage gates validate requirements (e.g. requiring a contact email or deal value before moving to `PROPOSAL`).
- **Priority Reordering**: Drag cards up or down within manual columns (`CONTACTED`, `IN_PIPELINE`, `PROPOSAL`, `WON`, `LOST`, `BACKLOG`) to reorder priority using fractional indexing.
- **Auto-Managed Guard**: Reordering within `DISCOVERED` and `QUALIFIED` is disabled with an explanatory tooltip, as those columns are strictly ranked by calculated ICE score.
- **Accessible Move Menu**: Click the three dots (⋮) on any card for an accessible, keyboard- and mobile-friendly column mover.
- **Horizontal Pan & Scroll**: On wide displays, hover over column headers to pan the board horizontally, while mouse-wheel gestures over card bodies scroll the page vertically.

---

## 5. Multi-CRM Exchange

Seamlessly exchange leads between Sales Lead Generator and your primary CRM from the `/sales/[brand]` toolbar:

### Exporting Leads
1. Click **Export** in the board header.
2. Select your scope: "All leads", "Currently filtered view", or "Selected leads only" (via Select Mode).
3. Choose your destination preset:
   - **Google Sheets / Universal CSV**: Formatted with UTF-8 BOM encoding for Excel, Numbers, and Google Sheets. Includes a 1-click **Copy for Google Sheets** button that copies clean TSV to your clipboard for instant `Cmd+V` paste into any sheet.
   - **HubSpot CRM**: Matches HubSpot's native Contacts & Companies bulk import schema.
   - **Salesforce**: Matches Salesforce Lead object standard import layout.
   - **Pipedrive**: Matches Pipedrive Organizations, Persons, and Deals schema.
4. Click **Download CSV** or **Copy to Clipboard**. Single leads can also be exported with 1 click from the Lead Detail drawer.

### Importing Leads
1. Click **Import** in the board header.
2. Drag and drop any `.csv` or `.tsv` file, browse from disk, or paste raw text directly.
3. The importer auto-detects headers and maps fields (Company, Contact Name, Email, Phone, Deal Value, Stage).
4. Review parsed leads in the interactive preview table.
5. Select conflict resolution:
   - **Skip Existing**: Ignores leads whose fingerprint or email already exists.
   - **Update Existing**: Merges new details and properties into existing records.
   - **Create All**: Ingests all rows as distinct records regardless of existing matches.
6. Click **Start Import**. Leads are assigned ICE scores and placed in their corresponding stages.

---

## 6. Unified Communication Center (Inbox)

Navigate to `/inbox/[brand]` for an omnichannel 3-pane communication console:

### 1. Stream Navigation (Left Pane)
- **Inbox**: Inbound prospect responses captured via Gmail sync or Resend inbound webhooks. Features dynamic unread count badges.
- **Needs Reply**: Urgent queue of threads where the prospect delivered the latest message.
- **Sent**: Outbound messages, manual sends, and automated sequence dispatches.
- **Internal Notes**: Team-internal discussions and handoff notes private to your organization.
- **Calls**: Phone call logs with disposition badges (`connected`, `voicemail`, `busy`, `no-answer`) and durations.
- **System**: Automated system alerts, calendar appointments, and cadence triggers.
- **Filters**: Quickly toggle **Starred Only**, **Unread Only**, or view the **Archived** folder.

### 2. Conversation Feed (Middle Pane)
- **User Mailbox Scoping & Privacy Isolation**:
  - The inbox console strictly isolates email correspondence to your own authenticated Gmail connection and leads assigned directly to you. Other sales representatives' emails are shielded to prevent cross-rep mailbox leakage.
  - **Multi-Identity Mailbox Linking**: If you sign in via Google SSO using your personal email (e.g. `moldovancsaba@gmail.com`) and have also connected a corporate Workspace mailbox (e.g. `coo@seyuselfies.com`), the inbox automatically recognizes your linked identities, unifying your personal and corporate correspondence into your unified My Inbox stream.
  - **Accounting & Provider Shielding**: Internal corporate domains and external service providers (e.g. accounting, payroll, and automated note-taker bots) are shielded from ever being harvested as CRM lead contacts.
- **Human-Friendly Sender Resolution**: Every card displays the real prospect name and email address. Prospects without prior lead records are never mislabeled as generic "System Communications".
- **Mailbox Attribution Tag**: Displays which connected personal mailbox synced the message.
- **Clean 2-Line Previews**: Snippet previews are sanitized of raw HTML tags, embedded CSS `<style>` blocks, and scripts.
- **Entity Status Badges**: Thread cards display 3 distinct status badges:
  - **Lead**: Teal badge (`Lead ✓`) if linked, or dashed gray (`No Lead`).
  - **Contact**: Blue badge (`Contact ✓` with count) if identified, or dashed gray (`No Contact`).
  - **Deal**: Grape badge (`Deal: €5,000` or count) if commercial deals are open, or dashed gray (`No Deal`).

### 3. Conversation Reader & Composer (Right Pane)
- **1-Click Conversion Actions**: Header displays the thread subject, sender identity, and 1-click modals (`+ Create Lead`, `+ Add Contact`, `+ Add Deal`).
- **Full Recipient Headers**: Chronological message bubbles explicitly display comma-separated `From:`, `To:`, and `Cc:` recipient lists.
- **In-Thread Quick Composer**:
  - Switch between **Reply via Email** and **Internal Note**.
  - Automatically chains RFC 2822 headers (`In-Reply-To`, `References`, `Re: <subject>`) to maintain conversation grouping in Gmail and Outlook.
  - Insert pre-approved messaging from Outreach Templates.
  - Insert dynamic merge tokens with live variable previews.
  - Attach sales collateral directly from your brand's Document Library.
  - Toggle automatic inclusion of your synced Google signature.

---

## 7. Email Contact Conversion & Multi-Company Harvesting

When reviewing inbound emails in `/inbox/[brand]`, the platform identifies all participants across `From:`, `To:`, and `Cc:` headers:

### Inferred Company Detection
- The system automatically extracts company names from sender email domains (e.g. `frh.ro` -> "FRH", `adidas.de` -> "Adidas").
- Common webmail domains (`gmail.com`, `yahoo.com`, `outlook.com`) are automatically excluded from company name inference.
- International country codes are inferred from country ccTLDs (`.de` -> DE, `.uk` -> GB, `.ro` -> RO, etc.).

### Selective Contact Harvesting Selector
When converting a thread, the `<ConvertModal />` displays an interactive participant selector:
- **Domain Badges**: Classifies each participant:
  - `Primary Contact` (the direct sender)
  - `Same Org (@domain)` (participants sharing the sender's business domain)
  - `Different Org (@external.com)` (counterparties from other corporate domains)
  - `Personal Webmail` (public webmail addresses)
- **Smart Default Selection**: The primary contact and all same-domain colleagues are pre-selected by default. External organizations and personal webmail addresses are unselected to protect CRM data hygiene.
- **Quick Filters**: Use "Only Primary", "Only @domain", or "Select All" buttons to adjust selections in one click.
- **Cross-Company Alert**: If you intentionally select contacts from multiple companies, an alert notifies you before conversion.

### Conversion Destination Controls
If an email thread relates to a prospect that already has an existing Lead in your CRM:
- **Add to Current Lead**: Appends harvested contacts and messages to the existing lead.
- **Create Separate Lead for [Company]**: Branches the conversation into an independent lead for the external company without breaking the original lead's link (`relinkThread: false`).
- **Separate Lead Button**: Available on the participant strip in the thread reader to branch any participant into an independent lead.

---

## 8. Lead Detail, Contacts & Buying Committee

Click any card or table row to open the comprehensive Lead Detail Drawer:

### Commercial Overview
- **Deals & Value**: Track multiple deal lines with distinct stages, currencies (`USD`, `EUR`), and target close dates.
- **ICE Scoring**: View detailed breakdowns of Impact, Confidence, and Ease factors.
- **Value Propositions**: Value drivers generated for the prospect's sector.
- **Checklist**: Track deal milestones and qualification criteria.

### Contacts & Buying Committee Roles
Manage multiple contacts per organization:
- Assign buying committee roles: **Decision Maker**, **Champion**, **Influencer**, **Evaluator**, or **Blocker**.
- Verified email indicators (deliverability verified via DNS MX/A checks).
- LinkedIn profile links, phone numbers, job titles, and department tags.
- Direct 1-click email and phone actions.

### Unified Activity Timeline
Complete audit log combining:
- Inbound and outbound emails with delivery and read statuses.
- Logged phone calls with dispositions and durations.
- Private internal team notes.
- System stage moves, score updates, and cadence dispatches.

---

## 9. Sequences, Cadences & Outreach Templates

Navigate to `/outreach/cadences/[brand]` and `/outreach/templates/[brand]`:

### Outreach Cadences
- Build multi-step outreach cadences combining automated emails with manual rep tasks:
  - `Email`: Automated template dispatch.
  - `Call`: Scheduled phone call task queued in Today.
  - `LinkedIn`: Social outreach or connection task.
  - `Task`: General research or follow-up task.
- **Stop on Reply**: Sequences pause automatically when a prospect replies to an email or books a meeting.
- **Last-Mile Suppression**: Prevents accidental outreach to active customers or unassigned leads.

### Templates & Merge Tokens
- Author reusable email templates with subject lines and body copy.
- Insert dynamic merge tokens using the token toolbar:
  - `{{contact_name}}`, `{{first_name}}`, `{{organization_name}}`
  - `{{sender_name}}`, `{{sender_email}}`, `{{sender_title}}`
  - `{{ticket_size}}`, `{{sport_or_sector}}`
- Live hover preview tooltips display real interpolated data before you send.

---

## 10. CPQ Quotes & PDF Generation

Configure products and generate professional PDF quotes from `/admin/products/[brand]` or directly within the Lead Detail drawer:

1. Open the **Quotes** tab in the Lead Detail drawer.
2. Click **Create Quote**.
3. Select product line items from your active Product Catalog (`/admin/products/[brand]`).
4. Set quantities, custom discounts, and payment terms.
5. Click **Generate PDF**. The platform generates a serverless PDF document via `@react-pdf/renderer` and stores it securely.
6. Click **Send to Prospect** to email the quote with a secure, rate-limited public review link (`/api/quotes/[quoteId]/view`).
7. Track quote status: `Draft`, `Sent`, `Viewed`, and `Signed`.

---

## 11. Reports, Analytics & Forecast Projections

### Reporting Workbench (`/reports/[brand]`)
- **Template Gallery**: Choose from pre-configured CRM reports:
  - *Pipeline Velocity & Conversion Rates*
  - *Rep Activity & Call Dispositions*
  - *Lead Source Performance*
  - *Revenue by Region & Sector*
- **View Switcher**: Toggle between **Bar Chart**, **Line Trend**, and **Data Table** views.
- **Null-Safety & Filtering**: Real-time filtering by date range, stage, and owner with automatic null-data sanitization.

### Forecast Projections (`/forecast/[brand]`)
- Real-time pipeline weighting and revenue projections.
- Win-rate calibration by stage and historical outcome correlation.
- Target attainment tracking against brand quotas configured in Sales Settings.

---

## 12. Accounts Directory & Company Hierarchy

Navigate to `/accounts/[brand]` to view parent organizations and enterprise accounts:
- **Parent-Child Rollups**: View all child leads and subsidiary branches grouped under parent organizations (e.g., leagues, sports holding groups, multi-club federations).
- **Aggregated Pipeline**: Total deal value, active pipeline count, and contact directory rolled up at the parent level.
- **Account Timeline**: Unified cross-subsidiary activity stream.
- **CSV Export**: 1-click export of accounts and rollups.

---

## 13. PWA Offline Support & Command Palette

### Progressive Web App (PWA)
- Install Sales Lead Generator as a desktop or mobile application directly from your browser (Chrome, Safari, Edge).
- **Offline Shell (`/offline`)**: If network connection drops, the app loads an offline shell allowing you to review cached data and queue actions for reconnect.

### Command Palette (`⌘K` / `Ctrl+K`)
Press `⌘K` anywhere in the application to open the Command Palette:
- **Jump to Lead**: Instant fuzzy search across all active leads in your workspace.
- **Quick Navigation**: Jump to Today, Pipeline, Inbox, Accounts, Contacts, Reports, or Sales Settings.
- **Quick Actions**: Add Lead, Export View, Open Tour, or Toggle Select Mode.
