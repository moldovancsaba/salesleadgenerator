import { NextResponse, type NextRequest } from 'next/server';
import clientPromise, { isMongoConfigured } from '@/lib/mongodb';
import { resolveBrand } from '@/app/lib/brand';
import { requireBrandAccessApi } from '@/lib/require-brand-access-api';
import { MCP_TOOLS, executeMcpTool } from '@/lib/mcp/server';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.json().catch(() => null);

    if (!rawBody || typeof rawBody !== 'object') {
      return NextResponse.json(
        { jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null },
        { status: 400 }
      );
    }

    const { jsonrpc, id, method, params } = rawBody;

    if (jsonrpc !== '2.0') {
      return NextResponse.json(
        { jsonrpc: '2.0', error: { code: -32600, message: 'Invalid Request: jsonrpc must be "2.0"' }, id: id ?? null },
        { status: 400 }
      );
    }

    // 1. Tool listing — doesn't require brand-specific DB access
    if (method === 'tools/list') {
      return NextResponse.json({
        jsonrpc: '2.0',
        result: {
          tools: MCP_TOOLS,
        },
        id,
      });
    }

    // 2. Tool execution — requires authentication & valid brand
    if (method === 'tools/call') {
      const toolName = params?.name;
      const toolArguments = params?.arguments || {};

      if (!toolName || typeof toolName !== 'string') {
        return NextResponse.json(
          { jsonrpc: '2.0', error: { code: -32602, message: 'Invalid params: name is required' }, id },
          { status: 400 }
        );
      }

      const brandParam = toolArguments.brand || 'cogmap';
      const brand = await resolveBrand(brandParam);
      if (!brand) {
        return NextResponse.json(
          {
            jsonrpc: '2.0',
            result: {
              content: [{ type: 'text', text: `Invalid or unknown brand: ${brandParam}` }],
              isError: true,
            },
            id,
          }
        );
      }

      // Authorize via API key or session cookie
      const authError = await requireBrandAccessApi(request, brand);
      if (authError) return authError;

      if (!isMongoConfigured()) {
        return NextResponse.json(
          {
            jsonrpc: '2.0',
            result: {
              content: [{ type: 'text', text: 'Database connection not configured' }],
              isError: true,
            },
            id,
          }
        );
      }

      const client = await clientPromise;
      const db = client.db();

      const execResult = await executeMcpTool(db, toolName, toolArguments, {
        tenantId: 'default',
        actorId: 'mcp-autonomous-agent',
        actorEmail: 'agent@slg.local',
      });

      return NextResponse.json({
        jsonrpc: '2.0',
        result: execResult,
        id,
      });
    }

    // Method not recognized
    return NextResponse.json(
      { jsonrpc: '2.0', error: { code: -32601, message: `Method not found: ${method}` }, id },
      { status: 404 }
    );
  } catch (error: any) {
    console.error('[API:mcp] JSON-RPC error:', error);
    return NextResponse.json(
      {
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal error', data: error?.message || String(error) },
        id: null,
      },
      { status: 500 }
    );
  }
}

// GET affordance providing tool schema documentation for agents probing the endpoint
export async function GET() {
  return NextResponse.json({
    name: 'sales-lead-generator-mcp',
    version: '1.0.0',
    description: 'Model Context Protocol (MCP) server for Sales Lead Generator pipeline and prospecting CRM.',
    transport: 'HTTP JSON-RPC 2.0 (POST /api/mcp)',
    tools: MCP_TOOLS,
  });
}
