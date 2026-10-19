import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

describe('LeadCard Layout & Hierarchy Redesign (Issue 259)', () => {
  const cardSource = readFileSync(join(root, 'app', 'card.tsx'), 'utf8');
  const globalsCss = readFileSync(join(root, 'app', 'globals.css'), 'utf8');

  it('renders entity name with full width, multi-line wrap, and hover title', () => {
    // Verifies lead.entity_name has its own dedicated Box/Text unconstrained by badges
    expect(cardSource).toContain('title={lead.entity_name}');
    expect(cardSource).toContain('WebkitLineClamp: 2');
    expect(cardSource).toContain("wordBreak: 'break-word'");
    expect(cardSource).toContain('{lead.entity_name}');
  });

  it('renders subtitle context for industry or sport/sector', () => {
    expect(cardSource).toContain('lead.industry || lead.sport_or_sector');
  });

  it('displays commercial metric (deal value or ticket size) in dedicated badge', () => {
    expect(cardSource).toContain('formatCompactCurrency(dealsTotal, dealCurrency)');
    expect(cardSource).toContain('ticketSizeLabel');
  });

  it('de-duplicates staleness and rotten touch day indicators', () => {
    // Stale deal condition takes precedence; rotten indicator only displays when staleness is null
    expect(cardSource).toContain('staleness ? (');
    expect(cardSource).toContain(': rotten ? (');
  });

  it('makes card surface clickable with onOpen and hover elevation', () => {
    expect(cardSource).toContain('onClick={handleCardClick}');
    expect(cardSource).toContain("cursor: onOpen ? 'pointer' : 'default'");

    // CSS provides smooth border-color and shadow transitions on hover
    expect(globalsCss).toContain('[data-gds-kanban-card]');
    expect(globalsCss).toContain('cursor: pointer;');
    expect(globalsCss).toContain('[data-gds-kanban-card]:hover');
    expect(globalsCss).toContain('box-shadow:');
  });

  it('preserves onboarding tour selectors on card and open button', () => {
    expect(cardSource).toContain('TOUR_SELECTOR.leadCard');
    expect(cardSource).toContain('TOUR_SELECTOR.leadDetailOpen');
  });

  it('maintains Owner metadata and assigns stopPropagation to interactive controls', () => {
    expect(cardSource).toContain("label: 'Owner'");
    expect(cardSource).toContain('lead.assignedToEmail');
    expect(cardSource).toContain('e.stopPropagation()');
  });
});
