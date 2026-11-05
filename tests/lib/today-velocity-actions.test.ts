import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..', '..');

describe('Issue 313: Today Dashboard Velocity Actions & 1-Click Dispositions', () => {
  it('renders inline call disposition buttons for high-velocity logging', () => {
    const today = readFileSync(join(root, 'app', 'today', '[brand]', 'today-client.tsx'), 'utf8');

    // Verifies 1-click disposition handler
    expect(today).toContain('handleInlineCallDisposition');
    expect(today).toContain("disposition: 'connected' | 'voicemail' | 'no-answer'");

    // Verifies inline action pills on cadence call tasks
    expect(today).toContain('Connected');
    expect(today).toContain('Voicemail');
    expect(today).toContain('Log Call…');
  });

  it('provides 1-click snooze buttons (+1d and +7d) on follow-up cards', () => {
    const today = readFileSync(join(root, 'app', 'today', '[brand]', 'today-client.tsx'), 'utf8');

    expect(today).toContain("handleSnooze(item.leadId, '1d')");
    expect(today).toContain("handleSnooze(item.leadId, '7d')");
    expect(today).toContain('+1d');
    expect(today).toContain('+7d');
    expect(today).toContain('Snooze…');
  });
});
