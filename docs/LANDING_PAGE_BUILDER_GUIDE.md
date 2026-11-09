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
| `showDigitalPasses` | **Digital Passes (Apple & Google Wallet)** | Generates live vCard contact QR code, `.pkpass` download for Apple Wallet, and save-to-wallet link for Google Wallet upon submission. |
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

## 5. Hostess QR Code Scanning

For events with on-site hostesses:
- Open the dedicated PWA scanner at `/landing/[brand]/[campaign]/qrreader`.
- Enter the hostess password (`iamthevegashostess2026`).
- Scan any attendee's badge or wallet pass.
- The lead is automatically advanced to the **"Engaged"** column in the CRM pipeline with timestamped notes.
