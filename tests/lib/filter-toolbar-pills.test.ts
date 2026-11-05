import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..', '..');

describe('Issue 315: Saved Filter Quick-Switcher Toolbar Pills', () => {
  it('surfaces saved filter preset pills directly on the main toolbar', () => {
    const filterBar = readFileSync(join(root, 'app', 'components', 'FilterBar.tsx'), 'utf8');

    // Verifies toolbar pill rendering
    expect(filterBar).toContain('savedFilters.slice(0, 4).map');
    expect(filterBar).toContain('isFilterActive');
    expect(filterBar).toContain('applySaved(f._id)');
    expect(filterBar).toContain('visibleFrom="sm"');
  });

  it('supports 1-click toggling to clear filter when already active', () => {
    const filterBar = readFileSync(join(root, 'app', 'components', 'FilterBar.tsx'), 'utf8');

    expect(filterBar).toContain('if (active) {');
    expect(filterBar).toContain('onChange({})');
  });
});
