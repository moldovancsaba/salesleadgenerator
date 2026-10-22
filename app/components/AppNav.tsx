'use client';

import { Suspense, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ActionIcon, Drawer, NavLink, Select, Stack, Divider, Text, Loader, Group, Box, Tooltip } from '@mantine/core';
import { CountBadge } from '@sovereignsquad/gds-core/client';
import {
  IconMenu2, IconLayoutKanban, IconTable, IconChartBar, IconSearch, IconTrendingUp,
  IconCards, IconMail, IconSettings, IconLogin, IconLogout, IconShieldLock, IconCopyCheck, IconEdit,
  IconAddressBook, IconRepeat, IconBuilding, IconBuildings, IconCompass, IconUsersGroup, IconBolt, IconShoppingCart, IconReportAnalytics, IconKey,
  IconCalendarTime, IconChevronLeft, IconFiles, IconInbox, IconSparkles,
} from '@tabler/icons-react';
import type { Brand } from '@/app/lib/brand';
import { useAuth } from './AuthProvider';
import { useTour } from './TourProvider';
import { useNav } from './NavContext';
import { TOUR_SELECTOR } from '../lib/tour/selectors';
import { UserSettingsModal } from './UserSettingsModal';

// Issue #95: this app had no persistent in-app navigation anywhere — every
// page (including Sales Settings) was only reachable by typing its URL
// directly. This is the single nav surface for the whole app, mounted once
// in the root layout so it's present on every page.
//
// Client isolation is load-bearing here, not cosmetic: an earlier version of
// this component listed every configured brand side by side under "Pipeline"
// and "Sales Settings" — showing CogMap and Seyu as sibling menu options in
// the same view. That's forbidden in this app (the same principle already
// enforced server-side — cross-brand vocabulary/field isolation, see
// docs/ARCHITECTURE.md's Input Validation section) and was corrected
// immediately once flagged.
//
// Issue #103: which brand's section shows is no longer purely a function of
// the current URL — it's the user's real SSO-derived access
// (useAuth().accessibleBrands), enforced server-side by every brand page's
// own requireBrandAccess() (this component only ever reflects that access,
// it never grants it). Three real states, not one: 0 accessible brands (a
// genuine "no access yet" state, distinct from "not logged in" or "no URL
// context"), exactly 1 (the per-client section, same as before), and 2+ (a
// new organization switcher — the first time this app can navigate between
// clients without knowing a URL by heart).
// Issue #195 — knownBrands (every configured brand's slug, regardless of
// the viewer's own access) is now passed in from useAuth().brandLabels
// (sourced server-side from the Mongo-backed brand registry) instead of
// this Client Component importing the static BRAND_CONFIG object directly.
function currentBrandFromPath(pathname: string, knownBrands: string[]): Brand | null {
  const knownBrandSet = new Set(knownBrands);
  const salesMatch = pathname.match(/^\/sales\/([^/]+)/);
  if (salesMatch && knownBrandSet.has(salesMatch[1])) return salesMatch[1] as Brand;
  const settingsMatch = pathname.match(/^\/salessettings\/([^/]+)/);
  if (settingsMatch && knownBrandSet.has(settingsMatch[1])) return settingsMatch[1] as Brand;
  const forecastMatch = pathname.match(/^\/forecast\/([^/]+)/);
  if (forecastMatch && knownBrandSet.has(forecastMatch[1])) return forecastMatch[1] as Brand;
  const battlecardsMatch = pathname.match(/^\/battlecards\/([^/]+)/);
  if (battlecardsMatch && knownBrandSet.has(battlecardsMatch[1])) return battlecardsMatch[1] as Brand;
  const templatesMatch = pathname.match(/^\/outreach\/templates\/([^/]+)/);
  if (templatesMatch && knownBrandSet.has(templatesMatch[1])) return templatesMatch[1] as Brand;
  const cadencesMatch = pathname.match(/^\/outreach\/cadences\/([^/]+)/);
  if (cadencesMatch && knownBrandSet.has(cadencesMatch[1])) return cadencesMatch[1] as Brand;
  const automationMatch = pathname.match(/^\/automation\/([^/]+)/);
  if (automationMatch && knownBrandSet.has(automationMatch[1])) return automationMatch[1] as Brand;
  const documentsMatch = pathname.match(/^\/documents\/([^/]+)/);
  if (documentsMatch && knownBrandSet.has(documentsMatch[1])) return documentsMatch[1] as Brand;
  const contactsMatch = pathname.match(/^\/contacts\/([^/]+)/);
  if (contactsMatch && knownBrandSet.has(contactsMatch[1])) return contactsMatch[1] as Brand;
  const accountsMatch = pathname.match(/^\/accounts\/([^/]+)/);
  if (accountsMatch && knownBrandSet.has(accountsMatch[1])) return accountsMatch[1] as Brand;
  const productsMatch = pathname.match(/^\/admin\/products\/([^/]+)/);
  if (productsMatch && knownBrandSet.has(productsMatch[1])) return productsMatch[1] as Brand;
  const reportsMatch = pathname.match(/^\/reports\/([^/]+)/);
  if (reportsMatch && knownBrandSet.has(reportsMatch[1])) return reportsMatch[1] as Brand;
  const todayMatch = pathname.match(/^\/today\/([^/]+)/);
  if (todayMatch && knownBrandSet.has(todayMatch[1])) return todayMatch[1] as Brand;
  const inboxMatch = pathname.match(/^\/inbox\/([^/]+)/);
  if (inboxMatch && knownBrandSet.has(inboxMatch[1])) return inboxMatch[1] as Brand;
  const whatsNewMatch = pathname.match(/^\/whats-new\/([^/]+)/);
  if (whatsNewMatch && knownBrandSet.has(whatsNewMatch[1])) return whatsNewMatch[1] as Brand;
  return null;
}

// This component reads useSearchParams() (for the View section's active
// state) and is mounted in the root layout on every page, including
// /_not-found — Next.js requires useSearchParams() call sites to sit inside
// a Suspense boundary or the build fails the static-bailout check for pages
// that don't otherwise opt into a search-param dependency. The fallback
// mirrors the trigger button so there's no visible flash while it resolves.
export function AppNav() {
  return (
    <Suspense fallback={<ActionIcon variant="filled" color="indigo" size={40} radius="md" aria-label="Toggle navigation menu"><IconMenu2 size={24} /></ActionIcon>}>
      <AppNavInner />
    </Suspense>
  );
}

function AppNavInner() {
  const { toggleNav, drawerOpen, closeDrawer, sidebarOpen } = useNav();

  return (
    <>
      <Tooltip label={sidebarOpen ? 'Collapse navigation sidebar' : 'Expand navigation sidebar'}>
        <ActionIcon
          variant={sidebarOpen ? 'light' : 'filled'}
          color="indigo"
          size={32}
          radius="md"
          aria-label={sidebarOpen ? 'Collapse navigation sidebar' : 'Expand navigation sidebar'}
          onClick={toggleNav}
          data-tour={TOUR_SELECTOR.navHamburger}
        >
          <IconMenu2 size={20} />
        </ActionIcon>
      </Tooltip>
      <Drawer
        opened={drawerOpen}
        onClose={closeDrawer}
        title={<Text fw={700} size="lg">Sales Lead Generator</Text>}
        padding="md"
        size="xs"
      >
        <AppNavContent onClose={closeDrawer} />
      </Drawer>
    </>
  );
}

export function AppNavSidebar() {
  const { sidebarOpen, setSidebarOpen, isDesktopOrTablet } = useNav();

  if (!sidebarOpen || !isDesktopOrTablet) return null;

  return (
    <aside
      style={{
        width: 250,
        flexShrink: 0,
        borderRight: '1px solid var(--mantine-color-gray-2)',
        backgroundColor: 'var(--mantine-color-body)',
        height: 'calc(100dvh - 48px)',
        overflowY: 'auto',
        position: 'sticky',
        top: 48,
        alignSelf: 'flex-start',
        zIndex: 20,
      }}
      aria-label="Main Navigation"
    >
      <Box p="sm">
        <Group justify="space-between" align="center" mb="xs" wrap="nowrap">
          <Text size="xs" fw={700} c="dimmed" tt="uppercase">
            Navigation
          </Text>
          <Tooltip label="Hide navigation bar">
            <ActionIcon
              variant="subtle"
              color="gray"
              size="sm"
              aria-label="Hide navigation bar"
              onClick={() => setSidebarOpen(false)}
            >
              <IconChevronLeft size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
        <Suspense fallback={<Group justify="center" py="lg"><Loader size="sm" /></Group>}>
          <AppNavContent />
        </Suspense>
      </Box>
    </aside>
  );
}

export function AppNavContent({ onClose }: { onClose?: () => void }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { user, loading, accessibleBrands, brandLabels, isSuperAdmin, login, logout } = useAuth();
  const { startTour } = useTour();
  const urlBrand = currentBrandFromPath(pathname, Object.keys(brandLabels));

  // The org switcher's own selection, independent of the URL — lets the
  // user browse a different organization's Reporting section before
  // actually navigating anywhere. Synced back to the URL's own brand
  // whenever it's a valid, accessible one (e.g. following a direct link),
  // so the switcher never silently disagrees with the page you're actually on.
  const [selectedBrand, setSelectedBrand] = useState<Brand | null>(null);
  const [userSettingsOpen, setUserSettingsOpen] = useState(false);
  const [unreadInboxCount, setUnreadInboxCount] = useState<number>(0);
  const [hasNewRelease, setHasNewRelease] = useState(false);

  useEffect(() => {
    try {
      const seen = localStorage.getItem('slg_seen_version');
      if (seen !== '2.4.326') {
        setHasNewRelease(true);
      }
    } catch {
      // Safe fallback
    }
  }, [pathname]);
  useEffect(() => {
    if (urlBrand && accessibleBrands.includes(urlBrand)) {
      setSelectedBrand((prev) => (prev === urlBrand ? prev : urlBrand));
    }
  }, [urlBrand, accessibleBrands]);

  const effectiveBrand: Brand | null =
    accessibleBrands.length === 1
      ? accessibleBrands[0]
      : selectedBrand && accessibleBrands.includes(selectedBrand)
        ? selectedBrand
        : accessibleBrands[0] ?? null;

  useEffect(() => {
    if (!effectiveBrand) return;
    let isMounted = true;
    fetch(`/api/inbox/${effectiveBrand}?limit=1`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (isMounted && data?.counts?.unread !== undefined) {
          setUnreadInboxCount(data.counts.unread);
        }
      })
      .catch(() => {});
    return () => {
      isMounted = false;
    };
  }, [effectiveBrand, pathname]);

  const isSalesBoard = effectiveBrand !== null && pathname === `/sales/${effectiveBrand}`;
  const currentView = searchParams.get('view') || 'kanban';

  const router = useRouter();

  const handleLinkClick = () => {
    if (onClose) onClose();
  };

  return (
    <Stack gap={4}>
      {loading ? (
        <Group justify="center" py="lg"><Loader size="sm" /></Group>
      ) : !user ? (
        <>
          <Text size="sm" c="dimmed" mt={4}>
            Sign in to see your organizations.
          </Text>
          <NavLink
            label="Sign in"
            leftSection={<IconLogin size={18} />}
            onClick={() => {
              handleLinkClick();
              login();
            }}
          />
        </>
      ) : (
        <>
          {accessibleBrands.length === 0 && (
            <Text size="sm" c="dimmed" mt={4}>
              You&apos;re signed in, but don&apos;t have access to any organization yet. Contact your admin.
            </Text>
          )}

          {accessibleBrands.length > 1 && (
            <>
              <Text size="xs" fw={600} c="dimmed" tt="uppercase" mt={4}>
                Organization
              </Text>
              <Select
                size="sm"
                data={accessibleBrands.map((b) => ({ value: b, label: brandLabels[b] ?? b }))}
                value={effectiveBrand}
                onChange={(value) => {
                  if (!value) return;
                  const nextBrand = value as Brand;
                  setSelectedBrand(nextBrand);
                  if (urlBrand && pathname.includes(`/${urlBrand}`)) {
                    router.push(pathname.replace(`/${urlBrand}`, `/${nextBrand}`));
                  } else {
                    router.push(`/sales/${nextBrand}`);
                  }
                  handleLinkClick();
                }}
                allowDeselect={false}
                aria-label="Switch organization"
                data-tour={TOUR_SELECTOR.brandSwitcher}
              />
              <Divider my="xs" />
            </>
          )}

          {effectiveBrand && (
            <>
              {accessibleBrands.length === 1 && (
                <Text size="xs" fw={600} c="dimmed" tt="uppercase" mt={4}>
                  {brandLabels[effectiveBrand] ?? effectiveBrand}
                </Text>
              )}
              <NavLink
                component={Link}
                href={`/today/${effectiveBrand}`}
                label="Today"
                leftSection={<IconCalendarTime size={18} />}
                active={pathname === `/today/${effectiveBrand}`}
                onClick={handleLinkClick}
              />
              <NavLink
                component={Link}
                href={`/inbox/${effectiveBrand}`}
                label="Inbox"
                leftSection={<IconInbox size={18} />}
                rightSection={
                  unreadInboxCount > 0 ? (
                    <CountBadge size="xs" value={unreadInboxCount} srLabel="Unread inbox messages" />
                  ) : null
                }
                active={pathname === `/inbox/${effectiveBrand}`}
                onClick={handleLinkClick}
              />
              <NavLink
                component={Link}
                href={`/sales/${effectiveBrand}`}
                label="Pipeline"
                leftSection={<IconLayoutKanban size={18} />}
                active={pathname === `/sales/${effectiveBrand}`}
                onClick={handleLinkClick}
              />
              {isSalesBoard && (
                <>
                  <Text size="xs" fw={600} c="dimmed" tt="uppercase" mt="xs">
                    Pipeline Views
                  </Text>
                  <NavLink
                    component={Link}
                    href={`/sales/${effectiveBrand}?view=kanban`}
                    label="Kanban"
                    leftSection={<IconLayoutKanban size={18} />}
                    active={currentView === 'kanban'}
                    onClick={handleLinkClick}
                  />
                  <NavLink
                    component={Link}
                    href={`/sales/${effectiveBrand}?view=table`}
                    label="Table"
                    leftSection={<IconTable size={18} />}
                    active={currentView === 'table'}
                    onClick={handleLinkClick}
                  />
                  <NavLink
                    component={Link}
                    href={`/sales/${effectiveBrand}?view=metrics`}
                    label="Metrics"
                    leftSection={<IconChartBar size={18} />}
                    active={currentView === 'metrics'}
                    onClick={handleLinkClick}
                  />
                  <NavLink
                    component={Link}
                    href={`/sales/${effectiveBrand}?view=search`}
                    label="Search Learning"
                    leftSection={<IconSearch size={18} />}
                    active={currentView === 'search'}
                    onClick={handleLinkClick}
                  />
                </>
              )}
              <NavLink
                component={Link}
                href={`/contacts/${effectiveBrand}`}
                label="Contacts"
                leftSection={<IconAddressBook size={18} />}
                active={pathname === `/contacts/${effectiveBrand}`}
                onClick={handleLinkClick}
              />
              <NavLink
                component={Link}
                href={`/accounts/${effectiveBrand}`}
                label="Accounts"
                leftSection={<IconBuildings size={18} />}
                active={pathname === `/accounts/${effectiveBrand}`}
                onClick={handleLinkClick}
              />

              <Divider my="xs" />

              <Text size="xs" fw={600} c="dimmed" tt="uppercase">
                Outreach & Content
              </Text>
              <NavLink
                component={Link}
                href={`/outreach/cadences/${effectiveBrand}`}
                label="Cadences"
                leftSection={<IconRepeat size={18} />}
                active={pathname === `/outreach/cadences/${effectiveBrand}`}
                onClick={handleLinkClick}
              />
              <NavLink
                component={Link}
                href={`/outreach/templates/${effectiveBrand}`}
                label="Outreach Templates"
                leftSection={<IconMail size={18} />}
                active={pathname === `/outreach/templates/${effectiveBrand}`}
                onClick={handleLinkClick}
              />
              <NavLink
                component={Link}
                href={`/documents/${effectiveBrand}`}
                label="Documents"
                leftSection={<IconFiles size={18} />}
                active={pathname === `/documents/${effectiveBrand}`}
                onClick={handleLinkClick}
              />
              <NavLink
                component={Link}
                href={`/battlecards/${effectiveBrand}`}
                label="Battlecards"
                leftSection={<IconCards size={18} />}
                active={pathname === `/battlecards/${effectiveBrand}`}
                onClick={handleLinkClick}
              />

              <Divider my="xs" />

              <Text size="xs" fw={600} c="dimmed" tt="uppercase">
                Analytics
              </Text>
              <NavLink
                component={Link}
                href={`/forecast/${effectiveBrand}`}
                label="Forecast"
                leftSection={<IconTrendingUp size={18} />}
                active={pathname === `/forecast/${effectiveBrand}`}
                onClick={handleLinkClick}
              />
              <NavLink
                component={Link}
                href={`/reports/${effectiveBrand}`}
                label="Reports"
                leftSection={<IconReportAnalytics size={18} />}
                active={pathname === `/reports/${effectiveBrand}`}
                onClick={handleLinkClick}
              />

              <Divider my="xs" />

              <Text size="xs" fw={600} c="dimmed" tt="uppercase">
                Settings
              </Text>
              <NavLink
                component={Link}
                href={`/salessettings/${effectiveBrand}`}
                label="Sales Settings"
                leftSection={<IconSettings size={18} />}
                active={pathname === `/salessettings/${effectiveBrand}`}
                onClick={handleLinkClick}
                data-tour={TOUR_SELECTOR.salesSettingsLink}
              />
              <NavLink
                component={Link}
                href={`/admin/products/${effectiveBrand}`}
                label="Product Catalog"
                leftSection={<IconShoppingCart size={18} />}
                active={pathname === `/admin/products/${effectiveBrand}`}
                onClick={handleLinkClick}
              />
              <NavLink
                component={Link}
                href={`/automation/${effectiveBrand}`}
                label="Automation"
                leftSection={<IconBolt size={18} />}
                active={pathname === `/automation/${effectiveBrand}`}
                onClick={handleLinkClick}
              />

              <Divider my="xs" />

              <Text size="xs" fw={600} c="dimmed" tt="uppercase">
                Help & Updates
              </Text>
              <NavLink
                component={Link}
                href={`/whats-new/${effectiveBrand}`}
                label="What's New"
                leftSection={<IconSparkles size={18} color="var(--mantine-color-indigo-6)" />}
                rightSection={hasNewRelease ? <CountBadge size="xs" value={1} srLabel="New release updates available" /> : null}
                active={pathname.startsWith('/whats-new')}
                onClick={handleLinkClick}
              />
              <NavLink
                label="Take the tour"
                leftSection={<IconCompass size={18} />}
                onClick={() => {
                  handleLinkClick();
                  startTour({ brand: effectiveBrand ?? undefined });
                }}
              />
            </>
          )}

          {isSuperAdmin && (
            <>
              <Divider my="xs" />
              <Text size="xs" fw={600} c="dimmed" tt="uppercase">
                Admin
              </Text>
              <NavLink
                component={Link}
                href={`/admin/prompts/${effectiveBrand}`}
                label="Prompt Editor"
                leftSection={<IconEdit size={18} />}
                active={pathname.startsWith('/admin/prompts')}
                onClick={handleLinkClick}
              />
              <NavLink
                component={Link}
                href="/admin/clients"
                label="Clients"
                leftSection={<IconBuilding size={18} />}
                active={pathname === '/admin/clients'}
                onClick={handleLinkClick}
              />
              <NavLink
                component={Link}
                href="/admin/users"
                label="Users & Access"
                leftSection={<IconShieldLock size={18} />}
                active={pathname === '/admin/users'}
                onClick={handleLinkClick}
              />
              <NavLink
                component={Link}
                href="/admin/teams"
                label="Teams"
                leftSection={<IconUsersGroup size={18} />}
                active={pathname === '/admin/teams'}
                onClick={handleLinkClick}
              />
              <NavLink
                component={Link}
                href="/admin/duplicates"
                label="Duplicate Review"
                leftSection={<IconCopyCheck size={18} />}
                active={pathname === '/admin/duplicates'}
                onClick={handleLinkClick}
              />
              <NavLink
                component={Link}
                href="/admin/api-keys"
                label="API Keys"
                leftSection={<IconKey size={18} />}
                active={pathname === '/admin/api-keys'}
                onClick={handleLinkClick}
              />
            </>
          )}

          <Divider my="xs" />
          <NavLink
            label="Email & Integrations"
            leftSection={<IconMail size={18} />}
            onClick={() => {
              handleLinkClick();
              setUserSettingsOpen(true);
            }}
          />
          <NavLink
            label={`Sign out${user.email ? ` (${user.email})` : ''}`}
            leftSection={<IconLogout size={18} />}
            onClick={() => {
              handleLinkClick();
              logout();
            }}
          />
          <UserSettingsModal
            opened={userSettingsOpen}
            onClose={() => setUserSettingsOpen(false)}
            brand={effectiveBrand || 'cogmap'}
          />
        </>
      )}
    </Stack>
  );
}
