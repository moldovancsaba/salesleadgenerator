import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..', '..');

describe('desktop and tablet navigation affordances', () => {
  it('keeps AppHeader clean with drawer launcher, title, and organization switcher', () => {
    const content = readFileSync(join(root, 'app', 'components', 'AppHeader.tsx'), 'utf8');
    expect(content).toContain('<AppNav />');
    expect(content).toContain('Sales Lead Generator');
    expect(content).toContain('activeBrand');
  });

  it('includes command launcher trigger affordance in AppHeader', () => {
    const content = readFileSync(join(root, 'app', 'components', 'AppHeader.tsx'), 'utf8');
    expect(content).toContain('useCommandLauncher');
    expect(content).toContain('launcher.open()');
    expect(content).toContain('⌘K');
  });

  it('includes inline view SegmentedControl switcher and Manage Pipelines trigger in sales page client', () => {
    const content = readFileSync(join(root, 'app', 'sales', '[brand]', 'sales-page-client.tsx'), 'utf8');
    expect(content).toContain('SegmentedControl');
    expect(content).toContain("{ label: 'Board', value: 'kanban' }");
    expect(content).toContain("{ label: 'Table', value: 'table' }");
    expect(content).toContain("{ label: 'Metrics', value: 'metrics' }");
    expect(content).not.toContain("{ label: 'Backlog', value: 'backlog' }");
    expect(content).toContain('Manage Pipelines');
    expect(content).toContain('<PipelineManagerModal');
  });

  it('gates PwaSetup gesture cancellation to compact mobile standalone only', () => {
    const content = readFileSync(join(root, 'app', 'components', 'PwaSetup.tsx'), 'utf8');
    expect(content).toContain('isMobileStandalone');
    expect(content).toContain('window.innerWidth < 768');
    expect(content).toContain("window.matchMedia('(display-mode: standalone)').matches");
  });

  it('configures responsive grid cols for tablet portrait on Today view', () => {
    const content = readFileSync(join(root, 'app', 'today', '[brand]', 'today-client.tsx'), 'utf8');
    expect(content).toContain('cols={{ base: 2, sm: 3, md: 5 }}');
  });

  it('supports organization switcher navigation in AppHeader and AppNav', () => {
    const header = readFileSync(join(root, 'app', 'components', 'AppHeader.tsx'), 'utf8');
    expect(header).toContain('router.push(`/sales/${newBrand}`)');

    const nav = readFileSync(join(root, 'app', 'components', 'AppNav.tsx'), 'utf8');
    expect(nav).toContain('router.push(`/sales/${nextBrand}`)');
  });

  it('keeps modal open and refreshes board on in-place actions like ASSIGN in sales-page-client', () => {
    const content = readFileSync(join(root, 'app', 'sales', '[brand]', 'sales-page-client.tsx'), 'utf8');
    expect(content).toContain("if (action === 'ACCEPT' || action === 'DECLINE')");
    expect(content).toContain('setRefreshKey((k) => k + 1)');
  });

  it('displays Deal Owner in card tier 0 metadata on every card', () => {
    const content = readFileSync(join(root, 'app', 'card.tsx'), 'utf8');
    expect(content).toContain("label: 'Owner'");
    expect(content).toContain('lead.assignedToEmail');
  });

  it('triggers assignment immediately on change and checks super admin role in detail modal', () => {
    const content = readFileSync(join(root, 'app', 'detail.tsx'), 'utf8');
    expect(content).toContain('handleAssign(next)');
    expect(content).toContain('isSuperAdmin');
  });

  it('safeguards columnStates in KanbanBoard against missing column definitions', () => {
    const content = readFileSync(join(root, 'app', 'kanban.tsx'), 'utf8');
    expect(content).toContain('const colState = columnStates[col.key] ||');
    expect(content).toContain('const colState = columnStates[column.id as KanbanColumn] ||');
  });

  it('displays readable error message in global error boundary', () => {
    const content = readFileSync(join(root, 'app', 'error.tsx'), 'utf8');
    expect(content).toContain('{error?.message && (');
  });

  it('renders AppLayout with docked AppNavSidebar on desktop/tablet', () => {
    const layout = readFileSync(join(root, 'app', 'components', 'AppLayout.tsx'), 'utf8');
    expect(layout).toContain('<AppHeader />');
    expect(layout).toContain('<AppNavSidebar />');
    expect(layout).toContain('{children}');
  });

  it('provides AppNavSidebar with collapsible hide affordance', () => {
    const nav = readFileSync(join(root, 'app', 'components', 'AppNav.tsx'), 'utf8');
    expect(nav).toContain('export function AppNavSidebar()');
    expect(nav).toContain('sidebarOpen');
    expect(nav).toContain('setSidebarOpen(false)');
    expect(nav).toContain('<AppNavContent');
  });

  it('prevents React error 185 infinite loops via registerCommandsRef and lastVisibleLeadIdsRef', () => {
    const salesClient = readFileSync(join(root, 'app', 'sales', '[brand]', 'sales-page-client.tsx'), 'utf8');
    expect(salesClient).toContain('const registerCommandsRef = useRef(registerCommands)');
    expect(salesClient).toContain('handleVisibleLeadsChange');

    const kanban = readFileSync(join(root, 'app', 'kanban.tsx'), 'utf8');
    expect(kanban).toContain('const lastVisibleLeadIdsRef = useRef<string>');
  });

  it('keeps navigation bar and header sticky without scrolling off screen', () => {
    const globals = readFileSync(join(root, 'app', 'globals.css'), 'utf8');
    expect(globals).toContain('overflow-x: clip;');
    expect(globals).not.toContain('overflow-x: hidden;');

    const nav = readFileSync(join(root, 'app', 'components', 'AppNav.tsx'), 'utf8');
    expect(nav).toContain("position: 'sticky'");
    expect(nav).toContain('alignSelf: \'flex-start\'');
    expect(nav).toContain('top: 48');

    const header = readFileSync(join(root, 'app', 'components', 'AppHeader.tsx'), 'utf8');
    expect(header).toContain("position: 'sticky'");
    expect(header).toContain('top: 0');
    expect(header).toContain("height: '48px'");

    const layout = readFileSync(join(root, 'app', 'components', 'AppLayout.tsx'), 'utf8');
    expect(layout).toContain("alignItems: 'flex-start'");
  });

  it('enforces identical, uniform 320px column width across uncollapsed Kanban columns and full-width backlog grid', () => {
    const globals = readFileSync(join(root, 'app', 'globals.css'), 'utf8');
    expect(globals).toContain('[data-gds-kanban-column]:not([data-gds-kanban-column="BACKLOG"]):not([data-gds-kanban-column-collapsed="true"])');
    expect(globals).toContain('width: 320px !important;');
    expect(globals).toContain('min-width: 320px !important;');
    expect(globals).toContain('max-width: 320px !important;');
    expect(globals).toContain('[data-gds-kanban-column="BACKLOG"]');
    expect(globals).toContain('width: 100% !important;');
    expect(globals).toContain('grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)) !important;');

    const kanban = readFileSync(join(root, 'app', 'kanban.tsx'), 'utf8');
    expect(kanban).toContain('columnWidth={320}');
  });

  it('models TableView and sales page client on Contacts reference layout with full width and rich CRM columns', () => {
    const table = readFileSync(join(root, 'app', 'table.tsx'), 'utf8');
    expect(table).toContain('AdminDataTable');
    expect(table).toContain("header: 'Lead Name'");
    expect(table).toContain("header: 'Deal Value'");
    expect(table).toContain("header: 'Stage'");
    expect(table).toContain("header: 'Primary Contact'");
    expect(table).toContain("header: 'Assignee'");

    const sales = readFileSync(join(root, 'app', 'sales', '[brand]', 'sales-page-client.tsx'), 'utf8');
    expect(sales).toContain("px={{ base: 'sm', sm: 'md', md: 'lg' }}");
    expect(sales).toContain('<Title order={2}');
    expect(sales).toContain('IconSearch');
  });

  it('standardizes secondary views on Contacts reference layout with count badges and explicit column widths', () => {
    const accounts = readFileSync(join(root, 'app', 'accounts', '[brand]', 'accounts-client.tsx'), 'utf8');
    expect(accounts).toContain('CountBadge');
    expect(accounts).toContain('width: 240');
    expect(accounts).toContain('IconSearch');

    const reports = readFileSync(join(root, 'app', 'reports', '[brand]', 'reports-client.tsx'), 'utf8');
    expect(reports).toContain('CountBadge');
    expect(reports).toContain('width: 280');

    const battlecards = readFileSync(join(root, 'app', 'battlecards', '[brand]', 'battlecards-client.tsx'), 'utf8');
    expect(battlecards).toContain('CountBadge');
    expect(battlecards).toContain('width: 240');

    const cadences = readFileSync(join(root, 'app', 'outreach', 'cadences', '[brand]', 'cadences-client.tsx'), 'utf8');
    expect(cadences).toContain('CountBadge');
    expect(cadences).toContain('width: 240');

    const templates = readFileSync(join(root, 'app', 'outreach', 'templates', '[brand]', 'templates-client.tsx'), 'utf8');
    expect(templates).toContain('CountBadge');
    expect(templates).toContain('width: 240');

    const automation = readFileSync(join(root, 'app', 'automation', '[brand]', 'automation-client.tsx'), 'utf8');
    expect(automation).toContain('CountBadge');
    expect(automation).toContain('width: 240');

    const products = readFileSync(join(root, 'app', 'admin', 'products', '[brand]', 'admin-products-client.tsx'), 'utf8');
    expect(products).toContain('CountBadge');
    expect(products).toContain('width: 280');
  });

  it('renders desktop horizontal navigation links in AppHeader for direct 1-click access when sidebar is collapsed', () => {
    const header = readFileSync(join(root, 'app', 'components', 'AppHeader.tsx'), 'utf8');
    expect(header).toContain('navItems');
    expect(header).toContain("label: 'Today'");
    expect(header).toContain("label: 'Inbox'");
    expect(header).toContain("label: 'Pipeline'");
    expect(header).toContain("label: 'Contacts'");
    expect(header).toContain("label: 'Accounts'");
    expect(header).toContain("label: 'Forecast'");
    expect(header).toContain("label: 'Reports'");
    expect(header).toContain('visibleFrom="md"');
    // Verifies inbox is recognized in brand path matching
    expect(header).toContain('today|inbox|contacts');
    // Verifies duplication guard: only renders horizontal links when left sidebar is collapsed
    expect(header).toContain('!sidebarOpen && accessibleBrands.length > 0');
  });

  it('provides responsive expand and collapse indicators on AppNav hamburger', () => {
    const nav = readFileSync(join(root, 'app', 'components', 'AppNav.tsx'), 'utf8');
    expect(nav).toContain("sidebarOpen ? 'Collapse navigation sidebar' : 'Expand navigation sidebar'");
    expect(nav).toContain("variant={sidebarOpen ? 'light' : 'filled'}");
  });

  it('surfaces What\'s New & Release Notes navigation in AppHeader and AppNav (issue 269)', () => {
    const header = readFileSync(join(root, 'app', 'components', 'AppHeader.tsx'), 'utf8');
    expect(header).toContain("Tooltip label=\"What's New & Release Notes\"");
    expect(header).toContain('/whats-new/${activeBrand}');
    expect(header).toContain('IconSparkles');

    const nav = readFileSync(join(root, 'app', 'components', 'AppNav.tsx'), 'utf8');
    expect(nav).toContain('label="What\'s New"');
    expect(nav).toContain('/whats-new/${effectiveBrand}');
  });

  it('eliminates organization switcher duplication and aligns CRM navigation taxonomy (issue 271)', () => {
    const header = readFileSync(join(root, 'app', 'components', 'AppHeader.tsx'), 'utf8');
    // Duplication guard: hides organization switcher from header when sidebar is docked on desktop
    expect(header).toContain('!(sidebarOpen && isDesktopOrTablet)');
    expect(header).toContain('Indicator');

    const nav = readFileSync(join(root, 'app', 'components', 'AppNav.tsx'), 'utf8');
    // Verifies aligned Core CRM grouping: Contacts & Accounts placed directly after Pipeline
    const pipelineIdx = nav.indexOf('label="Pipeline"');
    const contactsIdx = nav.indexOf('label="Contacts"');
    const accountsIdx = nav.indexOf('label="Accounts"');
    const cadencesIdx = nav.indexOf('label="Cadences"');
    expect(pipelineIdx).toBeGreaterThan(-1);
    expect(contactsIdx).toBeGreaterThan(pipelineIdx);
    expect(accountsIdx).toBeGreaterThan(contactsIdx);
    expect(cadencesIdx).toBeGreaterThan(accountsIdx);

    // Verifies clean semantic section headings
    expect(nav).toContain('Outreach & Content');
    expect(nav).toContain('Analytics');
    expect(nav).toContain('Settings');
    expect(nav).toContain('Help & Updates');
  });

  it('displays visible APP_VERSION badge in AppHeader and AppNav (issue 275)', () => {
    const header = readFileSync(join(root, 'app', 'components', 'AppHeader.tsx'), 'utf8');
    expect(header).toContain('APP_VERSION');
    expect(header).toContain('v{APP_VERSION}');

    const nav = readFileSync(join(root, 'app', 'components', 'AppNav.tsx'), 'utf8');
    expect(nav).toContain('APP_VERSION');
    expect(nav).toContain('Release Notes (v${APP_VERSION})');
    expect(nav).toContain('Version {APP_VERSION}');
  });
});
