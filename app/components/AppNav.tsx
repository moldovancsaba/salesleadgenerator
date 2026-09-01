'use client';

import { Suspense, useEffect, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ActionIcon, Drawer, NavLink, Select, Stack, Divider, Text, Button, Loader, Group } from '@mantine/core';
import {
  IconMenu2, IconLayoutKanban, IconTable, IconChartBar, IconSearch, IconTrendingUp,
  IconCards, IconMail, IconSettings, IconLogin, IconLogout, IconShieldLock, IconCopyCheck, IconEdit,
  IconArchive, IconAddressBook, IconRepeat, IconBuilding,
} from '@tabler/icons-react';
import type { Brand } from '@/app/lib/brand';
import { useAuth } from './AuthProvider';

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
  const contactsMatch = pathname.match(/^\/contacts\/([^/]+)/);
  if (contactsMatch && knownBrandSet.has(contactsMatch[1])) return contactsMatch[1] as Brand;
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
    <Suspense fallback={<ActionIcon variant="filled" color="indigo" size={40} radius="md" aria-label="Open navigation menu"><IconMenu2 size={24} /></ActionIcon>}>
      <AppNavInner />
    </Suspense>
  );
}

function AppNavInner() {
  const [opened, setOpened] = useState(false);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { user, loading, accessibleBrands, brandLabels, isSuperAdmin, login, logout } = useAuth();
  const urlBrand = currentBrandFromPath(pathname, Object.keys(brandLabels));

  // The org switcher's own selection, independent of the URL — lets the
  // user browse a different organization's Reporting section before
  // actually navigating anywhere. Synced back to the URL's own brand
  // whenever it's a valid, accessible one (e.g. following a direct link),
  // so the switcher never silently disagrees with the page you're actually on.
  const [selectedBrand, setSelectedBrand] = useState<Brand | null>(null);
  useEffect(() => {
    if (urlBrand && accessibleBrands.includes(urlBrand)) {
      setSelectedBrand(urlBrand);
    }
  }, [urlBrand, accessibleBrands]);

  const effectiveBrand: Brand | null =
    accessibleBrands.length === 1
      ? accessibleBrands[0]
      : selectedBrand && accessibleBrands.includes(selectedBrand)
        ? selectedBrand
        : accessibleBrands[0] ?? null;

  const isSalesBoard = effectiveBrand !== null && pathname === `/sales/${effectiveBrand}`;
  const currentView = searchParams.get('view') || 'kanban';

  const close = () => setOpened(false);

  return (
    <>
      {/* A bare "subtle" icon button (no fill, no border) reads as
          decorative rather than tappable — confirmed by real user report,
          it was invisible enough to be missed entirely next to the
          previously separate view-mode Select. Filled + a real color gives
          it the same visual weight as every other real button in this
          app. */}
      <ActionIcon
        variant="filled"
        color="indigo"
        size={40}
        radius="md"
        aria-label="Open navigation menu"
        onClick={() => setOpened(true)}
      >
        <IconMenu2 size={24} />
      </ActionIcon>
      <Drawer
        opened={opened}
        onClose={close}
        title={<Text fw={700} size="lg">Sales Lead Generator</Text>}
        padding="md"
        size="xs"
      >
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
                onClick={() => { close(); login(); }}
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
                    onChange={(value) => value && setSelectedBrand(value as Brand)}
                    allowDeselect={false}
                    aria-label="Switch organization"
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
                  {/* Issue #126 — positioned immediately before Pipeline,
                      per the owner's explicit request. Reuses the same
                      ?view= mechanism the View submenu below already
                      switches on, rather than a new route. */}
                  <NavLink
                    component={Link}
                    href={`/sales/${effectiveBrand}?view=backlog`}
                    label="Backlog"
                    leftSection={<IconArchive size={18} />}
                    active={currentView === 'backlog'}
                    onClick={close}
                  />
                  <NavLink
                    component={Link}
                    href={`/sales/${effectiveBrand}`}
                    label="Pipeline"
                    leftSection={<IconLayoutKanban size={18} />}
                    active={pathname === `/sales/${effectiveBrand}` && currentView !== 'backlog'}
                    onClick={close}
                  />
                  <NavLink
                    component={Link}
                    href={`/salessettings/${effectiveBrand}`}
                    label="Sales Settings"
                    leftSection={<IconSettings size={18} />}
                    active={pathname === `/salessettings/${effectiveBrand}`}
                    onClick={close}
                  />
                  {isSalesBoard && (
                    <>
                      <Text size="xs" fw={600} c="dimmed" tt="uppercase" mt="xs">
                        View
                      </Text>
                      <NavLink
                        component={Link}
                        href={`/sales/${effectiveBrand}?view=kanban`}
                        label="Kanban"
                        leftSection={<IconLayoutKanban size={18} />}
                        active={currentView === 'kanban'}
                        onClick={close}
                      />
                      <NavLink
                        component={Link}
                        href={`/sales/${effectiveBrand}?view=table`}
                        label="Table"
                        leftSection={<IconTable size={18} />}
                        active={currentView === 'table'}
                        onClick={close}
                      />
                      <NavLink
                        component={Link}
                        href={`/sales/${effectiveBrand}?view=metrics`}
                        label="Metrics"
                        leftSection={<IconChartBar size={18} />}
                        active={currentView === 'metrics'}
                        onClick={close}
                      />
                      <NavLink
                        component={Link}
                        href={`/sales/${effectiveBrand}?view=search`}
                        label="Search Learning"
                        leftSection={<IconSearch size={18} />}
                        active={currentView === 'search'}
                        onClick={close}
                      />
                    </>
                  )}
                  <Divider my="xs" />

                  <Text size="xs" fw={600} c="dimmed" tt="uppercase">
                    Reporting
                  </Text>
                  <NavLink
                    component={Link}
                    href={`/forecast/${effectiveBrand}`}
                    label="Forecast"
                    leftSection={<IconTrendingUp size={18} />}
                    active={pathname === `/forecast/${effectiveBrand}`}
                    onClick={close}
                  />
                  <NavLink
                    component={Link}
                    href={`/battlecards/${effectiveBrand}`}
                    label="Battlecards"
                    leftSection={<IconCards size={18} />}
                    active={pathname === `/battlecards/${effectiveBrand}`}
                    onClick={close}
                  />
                  <NavLink
                    component={Link}
                    href={`/outreach/templates/${effectiveBrand}`}
                    label="Outreach Templates"
                    leftSection={<IconMail size={18} />}
                    active={pathname === `/outreach/templates/${effectiveBrand}`}
                    onClick={close}
                  />
                  <NavLink
                    component={Link}
                    href={`/outreach/cadences/${effectiveBrand}`}
                    label="Cadences"
                    leftSection={<IconRepeat size={18} />}
                    active={pathname === `/outreach/cadences/${effectiveBrand}`}
                    onClick={close}
                  />
                  <NavLink
                    component={Link}
                    href={`/contacts/${effectiveBrand}`}
                    label="Contacts"
                    leftSection={<IconAddressBook size={18} />}
                    active={pathname === `/contacts/${effectiveBrand}`}
                    onClick={close}
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
                    onClick={close}
                  />
                  <NavLink
                    component={Link}
                    href="/admin/clients"
                    label="Clients"
                    leftSection={<IconBuilding size={18} />}
                    active={pathname === '/admin/clients'}
                    onClick={close}
                  />
                  <NavLink
                    component={Link}
                    href="/admin/users"
                    label="Users & Access"
                    leftSection={<IconShieldLock size={18} />}
                    active={pathname === '/admin/users'}
                    onClick={close}
                  />
                  <NavLink
                    component={Link}
                    href="/admin/duplicates"
                    label="Duplicate Review"
                    leftSection={<IconCopyCheck size={18} />}
                    active={pathname === '/admin/duplicates'}
                    onClick={close}
                  />
                </>
              )}

              <Divider my="xs" />
              <NavLink
                label={`Sign out${user.email ? ` (${user.email})` : ''}`}
                leftSection={<IconLogout size={18} />}
                onClick={() => { close(); logout(); }}
              />
            </>
          )}
        </Stack>
      </Drawer>
    </>
  );
}
