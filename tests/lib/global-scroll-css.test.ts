import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// Safari stops wheel and trackpad scrolling when html or body has vertical overscroll-behavior: none and a script
// adds a non-passive wheel listener to the document (Mantine's ScrollArea does). Only a WebKit run shows it.
describe('global scroll styles', () => {
  const css = fs.readFileSync(path.resolve(process.cwd(), 'app/globals.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

  it('does not set vertical overscroll-behavior on html or body', () => {
    const rules = [...css.matchAll(/([^{}]*)\{([^{}]*)\}/g)].filter(([, selector]) => /(^|[\s,])(html|body)\s*(,|$)/.test(selector.trim()));
    expect(rules.length).toBeGreaterThan(0);
    for (const [, selector, body] of rules) {
      expect(body, selector.trim()).not.toMatch(/overscroll-behavior(-y|-block)?\s*:\s*(none|contain)/);
      expect(body, selector.trim()).not.toMatch(/overscroll-behavior\s*:\s*[^;]*\b(none|contain)\b[^;]*\b(none|contain)\b/);
    }
  });
});
