# Landing Page Builder & Digital Goods Guide

This guide describes how administrators across all client tenants (`vegas`, `racket-land`, `seyu`, `dvsc`, `cogmap`) can create, publish, and manage high-converting lead collector landing pages enriched with digital goods (Apple Wallet, Google Wallet, and event badges).

---

## 1. Overview & Architecture

The Landing Page system is designed for **instant deployment without code changes or Vercel rebuilds**.

- **Admin Editor**: Located in the CRM at `/outreach/landing-pages/[brand]`.
- **Public URL**: Clean tenant routes at `/landing/[brand]/[campaign]`.
- **Database**: Saved and served dynamically from MongoDB `landing_pages` collection.
- **Lead Capture & Pipeline Sync**: Inbound submissions at `/api/forms/[brand]/submit` map directly to standard SLG Lead properties (`contacts`, `contactEmails`, `address`, `country`, `extraNotes`, `notes`).
- **Confirmation Email**: Automatic delivery via Resend (`lib/landing-confirmation-email.ts`) containing attendee summary details and 1-click links to Apple Wallet, Google Wallet, and high-res badges.

---

## 2. Modular Blocks Architecture

Every landing page consists of modular blocks that admins can **enable (show)** or **disable (hide)** with a single toggle:

| Block Key | Name | Description |
|:---|:---|:---|
| `showHeroBanner` | **Hero Banner Image** | Top-level high-res visual banner (aspect ratio 1248x562) with responsive object containment. |
| `showHeroCopy` | **Headline & Subheadline** | Introductory copy describing the event, dates, venue, or offer overview. |
| `showBullets` | **Callouts / Bullets** | Highlight key benefits, eligibility rules, or competition instructions. |
| `showDigitalPasses` | **Digital Passes (Apple & Google Wallet)** | Generates live vCard contact QR code, `.pkpass` download for Apple Wallet, and save-to-wallet link for Google Wallet upon submission. | **Off means a lead-collection-only page:** no badge, QR code, wallet, contact card or calendar entry after submission, and no confirmation email (the email only carries the pass). The lead is still saved and added to the pipeline.
| `showCalendarInvite` | **Calendar Invite (.ics)** | Generates an iCalendar file for 1-click addition to Apple/Google/Outlook Calendar. |
| `showFooterDisclaimer`| **Footer Legal Disclaimer** | Renders privacy consent text and link to the relevant tenant's Privacy Policy. |
| `showTermsModal` | **Terms & Conditions Modal** | Clickable link opening full terms and competition rules in a responsive dialog. |

---

## 3. Creating a Landing Page for Any Client

### Option A: Using the 1-Click VIP Pass Template
1. Navigate to `/outreach/landing-pages/[brand]` in the CRM.
2. Click **"VIP Pass Template"**.
3. This pre-fills the proven high-converting structure from the Mr Vegas Grand Slam of Darts campaign (including first name, last name, country, postcode, date of birth, and marketing opt-ins).
4. Update the **Page Title**, **URL Slug**, and dates/venue to match your client's event.
5. Click **"Save Landing Page"**.

### Option B: Building a Custom Blank Page
1. Click **"Create Blank Page"**.
2. Under the **Blocks & Modules** tab, toggle which sections should appear on your page.
3. Under **Content & Copy**, specify the title, banner image URL, headline, and success message.
4. Under **Form Fields**, pick properties from the **Lead Property Field Selector** (e.g. *Job Title*, *Company Name*, *Phone Number*, *Organization Size*). Reorder fields using the up/down arrows.
5. Under **Theme & Style**, pick a verified preset (Dark Emerald, Gold Luxury, Indigo Tech, Slate Minimal, Crimson Sport) or customize your brand colors.
6. Under **URL & Legal**, verify the slug and toggle the **Publish** switch.
7. Click **"Save Landing Page"**.

---

## 4. Digital Goods & Wallet Passes

When the **Digital Passes** block is enabled:
- **Apple Wallet (.pkpass)**: The user can tap **"Add to Apple Wallet"** directly on iOS to add a cobranded pass under the `haho.ai` umbrella with their contact info and hostess-scannable QR code.
- **Google Wallet**: The user can tap **"Add to Google Wallet / View Pass"** to save to their Android Google Wallet or view the high-resolution pass.
- **Badge Download**: Generates an 800x1200 high-res SVG / PNG badge optimized for camera scanning.
- **Confirmation Email**: Resend automatically sends an email containing all three pass links directly to their inbox so they can access their digital pass anytime.

---

## 5. Check-in scanner (any landing page)

Any landing page can feed the qualifier workflow from the event floor. The attendee pass the page gives each visitor carries a QR code; staff scan it with a phone and the matching lead moves forward in the pipeline.

**Turn it on:** open the page in the editor, go to **Pass &amp; check-in**, switch on **the check-in scanner**, set an **access code** and save. The staff link is `/landing/[brand]/[campaign]/qrreader` (the tab has copy and open buttons). A page without the scanner switched on has no reader: the link answers "not found".

| Setting | What it does |
| --- | --- |
| A scan moves the lead to | Discovered, Qualified, Engaged, Proposal or Won. A lead already further along stays where it is; a parked or lost lead moves up. The move runs through the normal lead action, so outcome logs, automation rules and webhooks fire as for a manual move. |
| Tags added on check-in | Up to 8 tags added to the lead, for reports and automation rules. |
| A scan with no matching lead creates one | A walk-in becomes a lead in the target column, tagged with the campaign. Switch off to refuse unknown badges ("No attendee matches this badge"). |
| Result headline and line | The words on the green result screen. |
| Access code | What staff type to unlock the reader. Stored on the server, checked on every scan, never sent to visitors. Eight wrong codes from one place lock it for five minutes. If a page has no code, the deployment's `HOSTESS_SCAN_PASSWORD` is used; with neither, the scanner stays closed. |
| Show the access code on the unlock screen | Prefills and prints the code on the unlock screen. Anyone who opens the link can then read it, so use it only when the link is shared with staff alone. |

**Event pass details** (same tab): event name, venue and date appear on the attendee pass, the calendar entry, the wallet passes and the confirmation email. Empty fields are left off; the event name falls back to the page title.

**What staff see:** after unlocking they tap **Start scanning**; the camera stays open for the next badge. Each result covers the camera and clears by itself or on tap: green (checked in; the lead's column is shown), amber **already checked in** (scanned before), red **not checked in** with the reason (not an attendee badge, no matching attendee, no connection, service unavailable). A QR code that is not an attendee badge, such as a link on a poster, creates no lead. The screen stays awake while scanning, and a light button appears on devices that support it.

**How a scan finds the lead:** the badge QR is a vCard with the attendee's name, email and phone. The scanner matches on email, then phone, then exact name, within the brand's leads.

**Known limits:** the matching is by contact details, so two campaigns of one brand share leads (a person who entered both is one lead). The wrong-code brake counts per server instance. Camera access needs a secure connection and the browser's permission.

