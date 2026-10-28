# Model Context Protocol (MCP) Server Guide

This guide explains how autonomous agent frameworks (such as **Paperclip**, Claude Desktop, Cursor, and custom multi-agent runtimes) can connect to **Sales Lead Generator** using the open **Model Context Protocol (MCP)**.

---

## 1. Overview

Sales Lead Generator provides an official Model Context Protocol (MCP) server allowing autonomous agents to:
- Inspect pipeline leads (`slg_search_leads`).
- Retrieve detailed prospect data and buying committee contacts (`slg_get_lead`).
- Generate 1-click executive pre-call briefings and domain tech-stack hooks (`slg_get_pre_call_briefing`).
- Ingest and enrich discovered prospects with automated deduplication (`slg_capture_lead`).
- Advance or update pipeline stages (`slg_update_lead_stage`).
- Query stage guidance and exit criteria (`slg_list_pipeline_stages`).

The MCP server is available via two transports:
1. **HTTP JSON-RPC 2.0**: Endpoint `POST /api/mcp` for cloud-to-cloud agents and remote orchestrators.
2. **Local STDIO Server**: CLI tool `bin/slg-mcp.js` for local autonomous agent execution.

---

## 2. Authentication

MCP requests are authenticated using **Scoped API Keys**:
- Generated in the web application under `/admin/api-keys` (prefix `slg_...`).
- Provided via HTTP Header: `x-api-key: slg_...` or `Authorization: Bearer slg_...`.
- In STDIO mode, provided via the `SLG_API_KEY` environment variable.

---

## 3. Connecting Paperclip AI

Paperclip is an autonomous multi-agent control plane orchestrating specialized agent teams. To equip Paperclip SDR and Account Executive agents with Sales Lead Generator capabilities:

### Option A: HTTP Transport (Recommended for Cloud Agents)

In your Paperclip server or agent tool definitions:
```json
{
  "name": "sales-lead-generator",
  "type": "mcp",
  "endpoint": "https://salesleadgenerator.vercel.app/api/mcp",
  "headers": {
    "x-api-key": "slg_your_api_key_here"
  }
}
```

### Option B: Local CLI Transport

If running Paperclip locally with subprocess execution:
```json
{
  "mcpServers": {
    "sales-lead-generator": {
      "command": "node",
      "args": ["/path/to/salesleadgenerator/bin/slg-mcp.js"],
      "env": {
        "SLG_API_URL": "https://salesleadgenerator.vercel.app",
        "SLG_API_KEY": "slg_your_api_key_here"
      }
    }
  }
}
```

---

## 4. Connecting Claude Desktop / Cursor

Add the server definition to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "salesleadgenerator": {
      "command": "node",
      "args": ["/Users/Shared/Projects/salesleadgenerator/bin/slg-mcp.js"],
      "env": {
        "SLG_API_URL": "https://salesleadgenerator.vercel.app",
        "SLG_API_KEY": "slg_your_api_key_here"
      }
    }
  }
}
```

---

## 5. Tool Specifications

| Tool Name | Description | Key Parameters |
|---|---|---|
| `slg_search_leads` | Search and filter leads across pipeline stages and countries | `brand`, `query`, `stage`, `country`, `limit` |
| `slg_get_lead` | Fetch a full lead document with contacts and deal health | `brand`, `leadId` |
| `slg_get_pre_call_briefing` | Generate pre-call cheat-sheet with discovery questions | `brand`, `leadId`, `currency` |
| `slg_capture_lead` | Ingest prospect with deduplication and ICE scoring | `brand`, `url`, `companyName`, `name`, `email` |
| `slg_update_lead_stage` | Move lead between Kanban stages | `brand`, `leadId`, `stage`, `declineReason` |
| `slg_list_pipeline_stages` | List configured stages, guidance, and talk tracks | `brand` |
