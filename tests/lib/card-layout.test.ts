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

  describe('Kanban Card Legibility and Hierarchy Enhancements (Issue 261)', () => {
    it('surfaces primary decision-maker or key contact with icon on card face', () => {
      expect(cardSource).toContain('IconUser');
      expect(cardSource).toContain('getDecisionMakerContact(lead.contacts)');
      expect(cardSource).toContain('No contact assigned');
      expect(cardSource).toContain('contactName !==');
    });

    it('formats raw sector and industry slugs into Title Case with delimiters', () => {
      expect(cardSource).toContain('formatSectorLabel');
      expect(cardSource).toContain("join(' · ')");
    });

    it('renders owner with initials avatar chip and formatted display name', () => {
      expect(cardSource).toContain('<Avatar');
      expect(cardSource).toContain('ownerInitials');
      expect(cardSource).toContain('title={`Owner: ${ownerLabel}`}');
    });

    it('suppresses redundant zero-day rotten badges when deals are fresh', () => {
      expect(cardSource).toContain("rotten.level === 'green' ? null :");
    });

    it('renders quiet subtle open button with arrow icon', () => {
      expect(cardSource).toContain('variant="subtle"');
      expect(cardSource).toContain('size="compact-xs"');
      expect(cardSource).toContain('IconArrowUpRight');
    });
  });

  describe('High-Affordance Card Architecture & Semantic GDS Actions (Issue 266)', () => {
    it('provides 1-click Quick Outreach email action for contacts with email', () => {
      expect(cardSource).toContain('IconMail');
      expect(cardSource).toContain('primaryContact?.email');
      expect(cardSource).toContain('onQuickEmail(lead)');
    });

    it('renders semantic stage-aware decisions with Accept and Decline actions', () => {
      expect(cardSource).toContain('isReviewColumn && onAction');
      expect(cardSource).toContain('color="teal"');
      expect(cardSource).toContain('IconCheck');
      expect(cardSource).toContain("onAction(lead._id, 'ACCEPT')");
      expect(cardSource).toContain('color="red"');
      expect(cardSource).toContain('IconX');
      expect(cardSource).toContain("onAction(lead._id, 'DECLINE')");
    });

    it('renders urgency alert status badges with icon for overdue and due today items', () => {
      expect(cardSource).toContain("dueDays < 0 ? 'danger' : 'warning'");
      expect(cardSource).toContain('withIcon');
      expect(cardSource).toContain('d overdue');
      expect(cardSource).toContain('Due today');
    });

    it('tokenizes card border and text styling to GDS standard variables', () => {
      expect(cardSource).toContain('var(--gds-border-card)');
      expect(cardSource).toContain('var(--gds-text-primary)');
    });
  });
});
