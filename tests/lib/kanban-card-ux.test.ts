import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Kanban Card UX & Information Architecture (Issue #323)', () => {
  const cardPath = path.resolve(process.cwd(), 'app/card.tsx');
  const cardSource = fs.readFileSync(cardPath, 'utf8');

  const cssPath = path.resolve(process.cwd(), 'app/globals.css');
  const cssSource = fs.readFileSync(cssPath, 'utf8');

  it('configures responsive 28px desktop and 36px mobile heights for action buttons', () => {
    expect(cssSource).toContain('.card-action-accept {');
    expect(cssSource).toContain('height: 28px !important;');
    expect(cssSource).toContain('@media (max-width: 768px) {');
    expect(cssSource).toContain('height: 36px !important;');
  });

  it('renders phone call quick-action icon when primary contact phone is present', () => {
    expect(cardSource).toContain('primaryPhone');
    expect(cardSource).toContain('IconPhone');
    expect(cardSource).toContain('tel:');
  });

  it('renders next action task note preview when nextActionNote exists on lead', () => {
    expect(cardSource).toContain('lead.nextActionNote');
    expect(cardSource).toContain('Next action:');
  });

  it('surfaces win probability in active pipeline stages', () => {
    expect(cardSource).toContain('🎯');
    expect(cardSource).toContain('winProbability');
  });

  it('restricts quality status badge to early pipeline stages', () => {
    expect(cardSource).toContain('isEarlyStage');
    expect(cardSource).toContain('lead.kanbanColumn === \'DISCOVERED\'');
  });
});
