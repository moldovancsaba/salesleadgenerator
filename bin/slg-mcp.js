#!/usr/bin/env node

// Standalone STDIO MCP Server for Sales Lead Generator
// Allows autonomous agent orchestrators (Paperclip, Claude Desktop, Cursor, local agent runtimes)
// to communicate over standard input/output with Sales Lead Generator.
//
// Usage:
//   SLG_API_URL="https://salesleadgenerator.vercel.app" SLG_API_KEY="slg_..." node bin/slg-mcp.js

import * as readline from 'readline';

const API_URL = (process.env.SLG_API_URL || 'https://salesleadgenerator.vercel.app').replace(/\/+$/, '');
const API_KEY = process.env.SLG_API_KEY || '';

if (!API_KEY) {
  process.stderr.write('[slg-mcp] Warning: SLG_API_KEY environment variable is not set. Requests may fail authorization.\n');
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

async function handleMessage(line) {
  const trimmed = line.trim();
  if (!trimmed) return;

  let request;
  try {
    request = JSON.parse(trimmed);
  } catch {
    const errorResponse = {
      jsonrpc: '2.0',
      error: { code: -32700, message: 'Parse error' },
      id: null,
    };
    process.stdout.write(JSON.stringify(errorResponse) + '\n');
    return;
  }

  try {
    const response = await fetch(`${API_URL}/api/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
      },
      body: JSON.stringify(request),
    });

    const data = await response.json();
    process.stdout.write(JSON.stringify(data) + '\n');
  } catch (error) {
    const errorResponse = {
      jsonrpc: '2.0',
      error: {
        code: -32603,
        message: 'Failed to communicate with Sales Lead Generator API',
        data: error?.message || String(error),
      },
      id: request?.id ?? null,
    };
    process.stdout.write(JSON.stringify(errorResponse) + '\n');
  }
}

rl.on('line', (line) => {
  handleMessage(line).catch((err) => {
    process.stderr.write(`[slg-mcp] Uncaught error: ${err?.message || err}\n`);
  });
});

process.stderr.write(`[slg-mcp] Sales Lead Generator MCP Server ready (target: ${API_URL})\n`);
