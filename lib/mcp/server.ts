// Model Context Protocol (MCP) Tools Registry & Execution Handlers
// Standards-compliant implementation of JSON-RPC 2.0 MCP tools for Sales Lead Generator
// Enables autonomous agents (Paperclip, Cursor, Claude, autonomous SDR agents) to
// query leads, fetch pre-call briefings, capture prospects, and advance deal stages.

import { generatePreCallBriefing } from '../pre-call-briefing';
import { generateDomainAuditPitch } from '../domain-audit-pitch';
import { STAGE_GUIDANCE_BY_KEY } from '../sales-playbooks';
import type { Db } from 'mongodb';
import { ObjectId } from 'mongodb';

export type McpToolDefinition = {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
};

export const MCP_TOOLS: McpToolDefinition[] = [
  {
    name: 'slg_search_leads',
    description: 'Search and filter sales leads in Sales Lead Generator across pipeline stages, countries, tags, or text queries.',
    inputSchema: {
      type: 'object',
      properties: {
        brand: {
          type: 'string',
          description: 'Workspace brand identifier (e.g. "cogmap", "seyu", "dvsc").',
        },
        query: {
          type: 'string',
          description: 'Optional free-text search query matching organization name, contacts, or notes.',
        },
        stage: {
          type: 'string',
          enum: ['DISCOVERED', 'QUALIFIED', 'ENGAGED', 'PROPOSAL', 'WON', 'LOST', 'BACKLOG'],
          description: 'Filter leads by specific Kanban pipeline stage.',
        },
        country: {
          type: 'string',
          description: 'Filter by ISO 3166-1 alpha-2 country code (e.g. "FR", "ES", "HU", "DE", "GB").',
        },
        tag: {
          type: 'string',
          description: 'Filter leads possessing a specific taxonomy tag or label.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of leads to return (default 20, max 100).',
        },
      },
      required: ['brand'],
    },
  },
  {
    name: 'slg_get_lead',
    description: 'Retrieve complete details for a specific sales lead by its ID, including decision makers, deal value, ICE score, and tech stack signals.',
    inputSchema: {
      type: 'object',
      properties: {
        brand: {
          type: 'string',
          description: 'Workspace brand identifier.',
        },
        leadId: {
          type: 'string',
          description: 'Hex string ID of the lead record.',
        },
      },
      required: ['brand', 'leadId'],
    },
  },
  {
    name: 'slg_get_pre_call_briefing',
    description: 'Generate an executive pre-call briefing cheat-sheet for a prospect, synthesizing tech stack commercial pitch, tailored discovery questions, anticipated objection rebuttals, and primary stakeholder context.',
    inputSchema: {
      type: 'object',
      properties: {
        brand: {
          type: 'string',
          description: 'Workspace brand identifier.',
        },
        leadId: {
          type: 'string',
          description: 'Hex string ID of the lead record.',
        },
        currency: {
          type: 'string',
          description: 'Currency symbol for deal valuations (default "€").',
        },
      },
      required: ['brand', 'leadId'],
    },
  },
  {
    name: 'slg_capture_lead',
    description: 'Capture or enrich a prospect lead in Sales Lead Generator from autonomous web research, LinkedIn profiles, or external data sources with deduplication.',
    inputSchema: {
      type: 'object',
      properties: {
        brand: {
          type: 'string',
          description: 'Target workspace brand identifier.',
        },
        url: {
          type: 'string',
          description: 'Primary web or LinkedIn URL of the organization or contact person.',
        },
        name: {
          type: 'string',
          description: 'Name of the key stakeholder or decision maker.',
        },
        companyName: {
          type: 'string',
          description: 'Official organization or team name.',
        },
        headline: {
          type: 'string',
          description: 'Professional headline or role description.',
        },
        location: {
          type: 'string',
          description: 'Location or country (e.g. "Paris, France").',
        },
        jobTitle: {
          type: 'string',
          description: 'Standardized job title (e.g. "Commercial Director").',
        },
        email: {
          type: 'string',
          description: 'Verified work email address.',
        },
        phone: {
          type: 'string',
          description: 'Direct or office phone number.',
        },
        buyingRole: {
          type: 'string',
          enum: ['economic_buyer', 'champion', 'influencer', 'decision_maker', 'unknown'],
          description: 'Buying committee role.',
        },
        notes: {
          type: 'string',
          description: 'Context notes, agent findings, or meeting discovery items.',
        },
      },
      required: ['brand', 'url', 'companyName'],
    },
  },
  {
    name: 'slg_update_lead_stage',
    description: 'Advance or transition a lead to a new pipeline Kanban stage (e.g. QUALIFIED, ENGAGED, PROPOSAL, WON, LOST).',
    inputSchema: {
      type: 'object',
      properties: {
        brand: {
          type: 'string',
          description: 'Workspace brand identifier.',
        },
        leadId: {
          type: 'string',
          description: 'Hex string ID of the lead record.',
        },
        stage: {
          type: 'string',
          enum: ['DISCOVERED', 'QUALIFIED', 'ENGAGED', 'PROPOSAL', 'WON', 'LOST', 'BACKLOG'],
          description: 'Destination stage column.',
        },
        declineReason: {
          type: 'string',
          description: 'Required only when moving to LOST or DECLINE (e.g. "BUDGET_CONSTRAINTS", "NO_DECISION_MAKER", "ALREADY_COMPETITOR").',
        },
      },
      required: ['brand', 'leadId', 'stage'],
    },
  },
  {
    name: 'slg_list_pipeline_stages',
    description: 'List the active pipeline Kanban stages, their sales objectives, exit criteria, and recommended talk tracks.',
    inputSchema: {
      type: 'object',
      properties: {
        brand: {
          type: 'string',
          description: 'Workspace brand identifier.',
        },
      },
      required: ['brand'],
    },
  },
];

export async function executeMcpTool(
  db: Db,
  toolName: string,
  args: Record<string, any>,
  context: { tenantId?: string; actorId?: string; actorEmail?: string } = {}
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  const tenantId = context.tenantId || 'default';

  try {
    switch (toolName) {
      case 'slg_search_leads': {
        const { brand, query, stage, country, tag, limit = 20 } = args;
        const brandConfig = await (await import('@/app/lib/brand')).getBrandConfig(brand);
        if (!brandConfig) {
          return { content: [{ type: 'text', text: `Unknown brand: ${brand}` }], isError: true };
        }

        const filter: any = {
          $or: [{ tenantId }, { tenantId: { $exists: false } }, { tenantId: 'default' }],
        };

        if (stage) filter.kanbanColumn = stage;
        if (country) filter.country = country.toUpperCase();
        if (tag) filter.tags = tag;

        if (query && typeof query === 'string' && query.trim()) {
          const safeQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          filter.$and = filter.$and || [];
          filter.$and.push({
            $or: [
              { entity_name: { $regex: safeQuery, $options: 'i' } },
              { name: { $regex: safeQuery, $options: 'i' } },
              { 'contacts.name': { $regex: safeQuery, $options: 'i' } },
              { notes: { $regex: safeQuery, $options: 'i' } },
            ],
          });
        }

        const cappedLimit = Math.min(Math.max(1, Number(limit) || 20), 100);
        const docs = await db
          .collection(brandConfig.dbCollection)
          .find(filter)
          .sort({ updatedAt: -1, createdAt: -1 })
          .limit(cappedLimit)
          .toArray();

        const results = docs.map((doc: any) => ({
          id: doc._id.toString(),
          name: doc.entity_name || doc.name,
          stage: doc.kanbanColumn,
          country: doc.country,
          region: doc.region,
          contactsCount: Array.isArray(doc.contacts) ? doc.contacts.length : 0,
          primaryContact: doc.contacts?.[0]
            ? {
                name: doc.contacts[0].name,
                role: doc.contacts[0].role || doc.contacts[0].title,
                email: doc.contacts[0].email,
              }
            : undefined,
          dealValue: doc.dealValue ?? doc.deals?.[0]?.value ?? doc.ticketSizeEstimate?.expected,
          techSignals: doc.techSignals || [],
          updatedAt: doc.updatedAt,
        }));

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ count: results.length, leads: results }, null, 2),
            },
          ],
        };
      }

      case 'slg_get_lead': {
        const { brand, leadId } = args;
        const brandConfig = await (await import('@/app/lib/brand')).getBrandConfig(brand);
        if (!brandConfig) {
          return { content: [{ type: 'text', text: `Unknown brand: ${brand}` }], isError: true };
        }

        if (!ObjectId.isValid(leadId)) {
          return { content: [{ type: 'text', text: `Invalid leadId: ${leadId}` }], isError: true };
        }

        const doc: any = await db.collection(brandConfig.dbCollection).findOne({
          _id: new ObjectId(leadId),
        });

        if (!doc) {
          return { content: [{ type: 'text', text: `Lead not found: ${leadId}` }], isError: true };
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(doc, null, 2),
            },
          ],
        };
      }

      case 'slg_get_pre_call_briefing': {
        const { brand, leadId, currency = '€' } = args;
        const brandConfig = await (await import('@/app/lib/brand')).getBrandConfig(brand);
        if (!brandConfig) {
          return { content: [{ type: 'text', text: `Unknown brand: ${brand}` }], isError: true };
        }

        if (!ObjectId.isValid(leadId)) {
          return { content: [{ type: 'text', text: `Invalid leadId: ${leadId}` }], isError: true };
        }

        const doc: any = await db.collection(brandConfig.dbCollection).findOne({
          _id: new ObjectId(leadId),
        });

        if (!doc) {
          return { content: [{ type: 'text', text: `Lead not found: ${leadId}` }], isError: true };
        }

        const briefing = generatePreCallBriefing(doc, currency);
        return {
          content: [
            {
              type: 'text',
              text: briefing.markdownCheatSheet,
            },
          ],
        };
      }

      case 'slg_capture_lead': {
        const { brand, url, companyName, name, headline, location, jobTitle, email, phone, buyingRole, notes } = args;
        const brandConfig = await (await import('@/app/lib/brand')).getBrandConfig(brand);
        if (!brandConfig) {
          return { content: [{ type: 'text', text: `Unknown brand: ${brand}` }], isError: true };
        }

        const { parseLinkedInLocation } = await import('../capture');
        const { buildFingerprint } = await import('../fingerprint');
        const { dedupeContacts, deriveContactEmails } = await import('../contacts');
        const { computeTicketSizeForLead } = await import('@/app/lib/ticket-size-store');

        const now = new Date();
        const nowIso = now.toISOString();
        const locationInfo = parseLinkedInLocation(location);
        const country = locationInfo.country || 'HU';
        const region = locationInfo.region || locationInfo.city || 'EMEA';
        const normalizedUrl = (url || '').trim().replace(/\/+$/, '');
        const cleanEmail = email ? email.toLowerCase().trim() : undefined;
        const fingerprint = buildFingerprint(companyName, '', region);

        const collection = db.collection(brandConfig.dbCollection);

        const orClauses: any[] = [
          { 'contacts.linkedin': { $regex: `^${normalizedUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } },
          { linkedin_url: { $regex: `^${normalizedUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } },
          { fingerprint },
        ];
        if (cleanEmail) orClauses.push({ contactEmails: cleanEmail });

        const existing = await collection.findOne({
          $and: [
            { $or: [{ tenantId }, { tenantId: { $exists: false } }, { tenantId: 'default' }] },
            { $or: orClauses },
          ],
        });

        const contactRecord = {
          name: name || 'Key Contact',
          title: jobTitle || headline || 'Executive',
          email: cleanEmail || '',
          phone: phone || '',
          linkedin: normalizedUrl,
          role: headline || jobTitle || 'Decision Maker',
          buyingRole: buyingRole || 'champion',
          isDecisionMaker: true,
          lastVerifiedAt: nowIso,
        };

        let leadId: string;
        let action: 'created' | 'updated';

        if (existing) {
          leadId = existing._id.toString();
          action = 'updated';
          const existingContacts = Array.isArray(existing.contacts) ? existing.contacts : [];
          const mergedContacts = dedupeContacts([...existingContacts, contactRecord], { verify: true });
          const contactEmails = deriveContactEmails(mergedContacts);

          const appendNote = `[Agent Capture ${nowIso.slice(0, 10)}] ${name || 'Contact'} (${jobTitle || headline || 'Profile'}): ${normalizedUrl}` +
            (notes ? `\nNotes: ${notes}` : '');
          const updatedNotes = existing.notes ? `${existing.notes}\n\n${appendNote}` : appendNote;

          await collection.updateOne(
            { _id: existing._id },
            {
              $set: {
                contacts: mergedContacts,
                contactEmails,
                notes: updatedNotes,
                updatedAt: now,
              },
            }
          );
        } else {
          action = 'created';
          const initialContacts = dedupeContacts([contactRecord], { verify: true });
          const contactEmails = deriveContactEmails(initialContacts);
          const ticketSizeEstimate = await computeTicketSizeForLead(db, brand, tenantId, { region });
          const count = await collection.countDocuments({ kanbanColumn: 'DISCOVERED', tenantId });

          const newDoc: any = {
            name: companyName,
            entity_name: companyName,
            industry: 'Sports & Entertainment',
            country,
            region,
            address: location || '',
            website: normalizedUrl.startsWith('http') ? normalizedUrl : '',
            linkedin_url: normalizedUrl,
            contacts: initialContacts,
            contactEmails,
            notes: (notes ? `Notes: ${notes}\n` : '') + `Captured via Autonomous Agent MCP on ${nowIso.slice(0, 10)}.`,
            kanbanColumn: 'DISCOVERED',
            source: 'MCP_AGENT',
            tenantId,
            fingerprint,
            sortOrder: count * 100,
            ticketSizeEstimate,
            createdAt: now,
            updatedAt: now,
          };

          const insertRes = await collection.insertOne(newDoc);
          leadId = insertRes.insertedId.toString();
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ ok: true, leadId, action, companyName, brand }, null, 2),
            },
          ],
        };
      }

      case 'slg_update_lead_stage': {
        const { brand, leadId, stage, declineReason } = args;
        const { executeLeadAction } = await import('@/app/lib/lead-actions');

        const result = await executeLeadAction({
          brand,
          tenantId,
          leadId,
          action: 'COLUMN_MOVE',
          payload: {
            destinationColumn: stage,
            ...(declineReason ? { declineReason } : {}),
          },
          actorId: context.actorId || 'mcp-agent',
          actorEmail: context.actorEmail || 'agent@slg.local',
        });

        if (!result.success) {
          return { content: [{ type: 'text', text: result.error || 'Failed to update stage' }], isError: true };
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ ok: true, leadId, stage, brand }, null, 2),
            },
          ],
        };
      }

      case 'slg_list_pipeline_stages': {
        const { brand } = args;
        const stages = Object.entries(STAGE_GUIDANCE_BY_KEY).map(([key, item]) => ({
          key,
          label: item.label,
          objective: item.objective,
          exitCriteria: item.exitCriteria,
          talkTrack: item.talkTrack,
        }));

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ brand, stages }, null, 2),
            },
          ],
        };
      }

      default:
        return {
          content: [{ type: 'text', text: `Unknown tool: ${toolName}` }],
          isError: true,
        };
    }
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `MCP Tool Execution Error: ${error?.message || String(error)}` }],
      isError: true,
    };
  }
}
