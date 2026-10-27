# Sales Lead Generator — LinkedIn Capture Extension

Manifest V3 browser extension for 1-click prospect ingestion from LinkedIn directly into Sales Lead Generator CRM workspaces (`cogmap`, `seyu`, `dvsc`).

## Architecture & Privacy Design
- **Zero Scraping / Anti-Bot Compliant**: The extension never runs background scraping, crawling, pagination, or automated connection requests. The content reader (`content.js`) is injected on explicit user click only.
- **Direct API Link**: Ingests prospect name, headline, current role, company name, location, public contact links, and about text directly to `/api/capture`.
- **Deduplication**: Automatically checks existing records across `contacts.linkedin`, `linkedin_url`, email, and company name fingerprint. Re-capturing an existing prospect enriches their contact profile and adds a timestamped capture note without creating duplicate cards.

## Installation in Chrome / Brave / Edge

1. Open `chrome://extensions/` in your browser.
2. Enable **Developer mode** (toggle in top-right corner).
3. Click **Load unpacked** and select this `extension/` folder from the repository.
4. Pin the **Sales Lead Generator** extension icon to your browser toolbar.

## Connecting to your CRM

1. Click the extension icon to open the popup.
2. Under **Connection Settings**:
   - **CRM Server URL**: e.g., `https://salesleadgenerator.vercel.app` (or `http://localhost:3000` for local testing).
   - **API Key**: A scoped or admin API key generated from **Sales Settings → Integrations** or Admin API Keys (`slg_...`).
3. Click **Save & Test Connection**. When verified, the status indicator turns green (`Connected`).

## How to Capture a Lead

1. Open any LinkedIn profile or Sales Navigator lead page (`https://www.linkedin.com/in/...`).
2. Click the extension icon.
3. Select your target Brand Workspace (`Cogmap`, `Seyu`, or `DVSC`).
4. Click **Capture LinkedIn Profile**.
5. The lead will immediately appear under the `DISCOVERED` pipeline column in your selected CRM board.
