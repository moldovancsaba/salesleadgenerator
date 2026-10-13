import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { APP_CHROME_COLORS } from '../../lib/theme/app-chrome-colors';
import manifestRoute from '../../app/manifest';

const root = join(__dirname, '..', '..');

describe('PWA manifest configuration', () => {
  it('loads valid JSON from public/manifest.json', () => {
    const raw = readFileSync(join(root, 'public', 'manifest.json'), 'utf8');
    const manifest = JSON.parse(raw);
    expect(manifest.name).toBe('Sales Lead Generator');
    expect(manifest.short_name).toBe('Sales Leads');
    expect(manifest.display).toBe('standalone');
    expect(manifest.theme_color).toBe(APP_CHROME_COLORS.themeColor);
  });

  it('defines shortcuts for Today Queue and Pipelines in static manifest', () => {
    const manifest = JSON.parse(readFileSync(join(root, 'public', 'manifest.json'), 'utf8'));
    expect(Array.isArray(manifest.shortcuts)).toBe(true);
    expect(manifest.shortcuts.length).toBeGreaterThanOrEqual(2);

    const urls = manifest.shortcuts.map((s: { url: string }) => s.url);
    expect(urls).toContain('/today/cogmap');
    expect(urls).toContain('/sales/cogmap');
  });

  it('verifies that all referenced icons exist in public directory', () => {
    const manifest = JSON.parse(readFileSync(join(root, 'public', 'manifest.json'), 'utf8'));
    expect(Array.isArray(manifest.icons)).toBe(true);

    for (const icon of manifest.icons) {
      const relPath = icon.src.startsWith('/') ? icon.src.slice(1) : icon.src;
      const fullPath = join(root, 'public', relPath);
      expect(existsSync(fullPath)).toBe(true);
    }
  });

  it('declares maskable icon support in static manifest', () => {
    const manifest = JSON.parse(readFileSync(join(root, 'public', 'manifest.json'), 'utf8'));
    const maskable = manifest.icons.filter(
      (icon: { purpose?: string }) => icon.purpose && icon.purpose.includes('maskable')
    );
    expect(maskable.length).toBeGreaterThanOrEqual(1);
  });

  it('generates compliant Next.js manifest metadata route', () => {
    const dynamicManifest = manifestRoute();
    expect(dynamicManifest.name).toBe('Sales Lead Generator');
    expect(dynamicManifest.display).toBe('standalone');
    expect(dynamicManifest.theme_color).toBe(APP_CHROME_COLORS.themeColor);
    expect(Array.isArray(dynamicManifest.shortcuts)).toBe(true);
    expect(dynamicManifest.shortcuts?.length).toBeGreaterThanOrEqual(2);
  });
});
