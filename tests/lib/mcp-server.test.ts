import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MCP_TOOLS, executeMcpTool } from '@/lib/mcp/server';
import { ObjectId } from 'mongodb';

vi.mock('@/app/lib/brand', () => ({
  getBrandConfig: vi.fn().mockResolvedValue({
    key: 'cogmap',
    dbCollection: 'leads',
  }),
}));

vi.mock('@/app/lib/lead-actions', () => ({
  executeLeadAction: vi.fn().mockResolvedValue({
    success: true,
    lead: { kanbanColumn: 'QUALIFIED' },
  }),
}));

describe('MCP Server (Issue 296)', () => {
  let mockDb: any;
  let leadsCollection: any;
  let testLead: any;

  beforeEach(() => {
    testLead = {
      _id: new ObjectId(),
      entity_name: 'FC Bayern Munich',
      name: 'FC Bayern Munich',
      country: 'DE',
      region: 'Bavaria',
      kanbanColumn: 'DISCOVERED',
      industry: 'Football Club',
      techSignals: ['shopify', 'react'],
      contacts: [
        {
          name: 'Oliver Kahn',
          role: 'CEO',
          email: 'o.kahn@fcbayern.com',
          isDecisionMaker: true,
        },
      ],
      notes: 'Initial scout notes.',
      updatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };

    leadsCollection = {
      find: vi.fn().mockReturnValue({
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([testLead]),
        }),
      }),
      findOne: vi.fn().mockImplementation(async (query: any) => {
        if (query._id && query._id.toString() === testLead._id.toString()) {
          return testLead;
        }
        return null;
      }),
      countDocuments: vi.fn().mockResolvedValue(1),
      insertOne: vi.fn().mockImplementation(async (doc: any) => ({
        insertedId: new ObjectId(),
      })),
      updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    };

    mockDb = {
      collection: vi.fn().mockImplementation((name: string) => {
        if (name === 'leads') return leadsCollection;
        return {
          findOne: vi.fn().mockResolvedValue(null),
          updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
          find: vi.fn().mockReturnValue({
            sort: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
          }),
        };
      }),
    };
  });

  it('exposes all required tools in MCP_TOOLS schema', () => {
    const toolNames = MCP_TOOLS.map((t) => t.name);
    expect(toolNames).toContain('slg_search_leads');
    expect(toolNames).toContain('slg_get_lead');
    expect(toolNames).toContain('slg_get_pre_call_briefing');
    expect(toolNames).toContain('slg_capture_lead');
    expect(toolNames).toContain('slg_update_lead_stage');
    expect(toolNames).toContain('slg_list_pipeline_stages');
  });

  it('slg_search_leads returns matching leads', async () => {
    const result = await executeMcpTool(mockDb, 'slg_search_leads', {
      brand: 'cogmap',
      query: 'Bayern',
    });

    expect(result.isError).toBeFalsy();
    expect(result.content[0].type).toBe('text');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.count).toBe(1);
    expect(parsed.leads[0].name).toBe('FC Bayern Munich');
  });

  it('slg_get_lead returns lead document', async () => {
    const result = await executeMcpTool(mockDb, 'slg_get_lead', {
      brand: 'cogmap',
      leadId: testLead._id.toString(),
    });

    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.entity_name).toBe('FC Bayern Munich');
  });

  it('slg_get_pre_call_briefing generates executive cheat sheet', async () => {
    const result = await executeMcpTool(mockDb, 'slg_get_pre_call_briefing', {
      brand: 'cogmap',
      leadId: testLead._id.toString(),
    });

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('# Pre-Call Executive Briefing: FC Bayern Munich');
    expect(result.content[0].text).toContain('Oliver Kahn (CEO)');
  });

  it('slg_capture_lead captures new prospect', async () => {
    const result = await executeMcpTool(mockDb, 'slg_capture_lead', {
      brand: 'cogmap',
      companyName: 'Borussia Dortmund',
      url: 'https://bvb.de',
      name: 'Hans-Joachim Watzke',
      jobTitle: 'Managing Director',
    });

    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.ok).toBe(true);
    expect(parsed.companyName).toBe('Borussia Dortmund');
  });

  it('slg_update_lead_stage moves pipeline stage', async () => {
    const result = await executeMcpTool(mockDb, 'slg_update_lead_stage', {
      brand: 'cogmap',
      leadId: testLead._id.toString(),
      stage: 'QUALIFIED',
    });

    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.ok).toBe(true);
    expect(parsed.stage).toBe('QUALIFIED');
  });

  it('slg_list_pipeline_stages returns guidance', async () => {
    const result = await executeMcpTool(mockDb, 'slg_list_pipeline_stages', {
      brand: 'cogmap',
    });

    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.stages.length).toBeGreaterThan(0);
    expect(parsed.stages.some((s: any) => s.key === 'DISCOVERED')).toBe(true);
  });
});
