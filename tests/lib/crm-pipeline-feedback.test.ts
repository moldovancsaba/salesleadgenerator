import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { validateLeadPayload, validatePatchPayload } from '@/lib/validate-lead';
import { normalizeLead } from '@/app/lib/normalize-lead';

const root = join(__dirname, '..', '..');

describe('CRM pipeline feedback and lifecycle alignment (issue 245)', () => {
  it('supports custom pipeline stage keys in validateLeadPayload, validatePatchPayload, and normalizeLead', () => {
    const customStages = ['DISCOVERED', 'DEMO_SCHEDULED', 'CONTRACT_REVIEW', 'WON', 'LOST'];

    const leadResult = validateLeadPayload(
      {
        entity_name: 'Acme Robotics',
        kanbanColumn: 'DEMO_SCHEDULED',
      },
      'cogmap',
      [],
      { partial: true, allowedColumns: customStages },
    );
    expect(leadResult.valid).toBe(true);

    const patchResult = validatePatchPayload(
      {
        id: 'lead_1',
        action: 'COLUMN_MOVE',
        kanbanColumn: 'CONTRACT_REVIEW',
      },
      'cogmap',
      [],
      { allowedColumns: customStages },
    );
    expect(patchResult.valid).toBe(true);

    const invalidPatch = validatePatchPayload(
      {
        id: 'lead_1',
        action: 'COLUMN_MOVE',
        kanbanColumn: 'UNCONFIGURED_STAGE',
      },
      'cogmap',
      [],
      { allowedColumns: customStages },
    );
    expect(invalidPatch.valid).toBe(false);

    const normalized = normalizeLead(
      { _id: 'lead_1', entity_name: 'Acme Robotics', kanbanColumn: 'DEMO_SCHEDULED' },
      { allowedColumns: customStages },
    );
    expect(normalized.kanbanColumn).toBe('DEMO_SCHEDULED');
  });

  it('defaults dragEnabled to true in GET /api/settings and KanbanBoard', () => {
    const settingsRoute = readFileSync(join(root, 'app', 'api', 'settings', 'route.ts'), 'utf8');
    expect(settingsRoute).toContain('const dragEnabled = dragEnabledDoc ? dragEnabledDoc.enabled !== false : true');

    const kanban = readFileSync(join(root, 'app', 'kanban.tsx'), 'utf8');
    expect(kanban).toContain('const [dragEnabled, setDragEnabled] = useState(true)');
  });

  it('allows customizing the default pipeline stages via PATCH /api/pipelines/[id]', () => {
    const pipelineIdRoute = readFileSync(join(root, 'app', 'api', 'pipelines', '[id]', 'route.ts'), 'utf8');
    expect(pipelineIdRoute).toContain('isDefaultPipelineId(id, brand)');
    expect(pipelineIdRoute).toContain('upsert: true');
  });

  it('provides PipelineManagerModal and Manage Pipelines button on the sales board', () => {
    const modal = readFileSync(join(root, 'app', 'components', 'PipelineManagerModal.tsx'), 'utf8');
    expect(modal).toContain('export function PipelineManagerModal');
    expect(modal).toContain('Create Pipeline');
    expect(modal).toContain('Add Stage');

    const salesPage = readFileSync(join(root, 'app', 'sales', '[brand]', 'sales-page-client.tsx'), 'utf8');
    expect(salesPage).toContain('Manage Pipelines');
    expect(salesPage).toContain('<PipelineManagerModal');
  });

  it('removes Accept, Decline, and Move to Backlog buttons from cards, board, and detail modal', () => {
    const card = readFileSync(join(root, 'app', 'card.tsx'), 'utf8');
    expect(card).not.toContain('onAccept');
    expect(card).not.toContain('onDecline');
    expect(card).toContain("label: 'Owner'");

    const kanban = readFileSync(join(root, 'app', 'kanban.tsx'), 'utf8');
    expect(kanban).not.toContain('Accept selected');
    expect(kanban).not.toContain('Decline selected');
    expect(kanban).not.toContain('Move to Backlog');

    const detail = readFileSync(join(root, 'app', 'detail.tsx'), 'utf8');
    expect(detail).toContain('PIPELINE STAGE');
    expect(detail).toContain('DEAL OWNER (ASSIGNMENT)');
    expect(detail).toContain('Mark Won');
    expect(detail).toContain('Mark Lost');
    expect(detail).not.toContain("ariaLabel: 'Approve'");
    expect(detail).not.toContain("ariaLabel: 'Reject'");
    expect(detail).not.toContain("action: 'lead:backlog'");
  });

  it('keeps OutreachComposeModal compose form available when zero templates match and integrates Gmail connect and sync', () => {
    const compose = readFileSync(join(root, 'app', 'outreach', 'compose-modal.tsx'), 'utf8');
    expect(compose).toContain('compose a freeform outreach message below');
    expect(compose).toContain('Connect Gmail');
    expect(compose).toContain('Send via Gmail');

    const activity = readFileSync(join(root, 'app', 'components', 'ActivityPanel.tsx'), 'utf8');
    expect(activity).toContain('Sync Gmail');
    expect(activity).toContain('Compose / Log Outreach');
  });
});
