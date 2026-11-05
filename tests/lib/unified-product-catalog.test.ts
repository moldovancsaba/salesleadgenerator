import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..', '..');

describe('Issue 316: Unify Product Catalog into Sales Settings Tab', () => {
  it('redirects /admin/products/[brand] to /salessettings/[brand]?tab=products', () => {
    const page = readFileSync(join(root, 'app', 'admin', 'products', '[brand]', 'page.tsx'), 'utf8');

    expect(page).toContain("redirect(`/salessettings/${brand}?tab=products`)");
  });

  it('handles tab query parameter (?tab=products) in SalesSettingsClient', () => {
    const client = readFileSync(join(root, 'app', 'salessettings', '[client]', 'sales-settings-client.tsx'), 'utf8');

    expect(client).toContain("const tabParam = params.get('tab')");
    expect(client).toContain("setActiveTab(tabParam)");
    expect(client).toContain('value="products"');
  });

  it('updates AppNav to link directly to consolidated products tab', () => {
    const nav = readFileSync(join(root, 'app', 'components', 'AppNav.tsx'), 'utf8');

    expect(nav).toContain("href={`/salessettings/${effectiveBrand}?tab=products`}");
  });
});
