'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { ActionIcon, Drawer, NavLink, Stack, Divider, Text } from '@mantine/core';
import { IconMenu2, IconLayoutKanban, IconChartBar, IconCards, IconMail, IconSettings } from '@tabler/icons-react';
import { BRAND_CONFIG, type Brand } from '@/app/lib/brand';

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
// immediately once flagged: the menu now only ever shows links for whichever
// single client the current page actually belongs to, derived strictly from
// the URL. On a page with no client context (the brand-agnostic Reporting
// pages, or the root landing page), no client-specific link is shown at
// all — never a guess, and never both.
function currentBrandFromPath(pathname: string): Brand | null {
  const salesMatch = pathname.match(/^\/sales\/([^/]+)/);
  if (salesMatch && salesMatch[1] in BRAND_CONFIG) return salesMatch[1] as Brand;
  const settingsMatch = pathname.match(/^\/salessettings\/([^/]+)/);
  if (settingsMatch && settingsMatch[1] in BRAND_CONFIG) return settingsMatch[1] as Brand;
  return null;
}

export function AppNav() {
  const [opened, setOpened] = useState(false);
  const pathname = usePathname();
  const currentBrand = currentBrandFromPath(pathname);

  const close = () => setOpened(false);

  return (
    <>
      {/* A bare "subtle" icon button (no fill, no border) reads as
          decorative rather than tappable — confirmed by real user report,
          it was invisible enough to be missed entirely next to the much
          more visually prominent view-mode Select ("Kanban ▾") that sits
          right below it. Filled + a real color gives it the same visual
          weight as every other real button in this app. */}
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
          {currentBrand && (
            <>
              <Text size="xs" fw={600} c="dimmed" tt="uppercase" mt={4}>
                {BRAND_CONFIG[currentBrand].label}
              </Text>
              <NavLink
                component={Link}
                href={`/sales/${currentBrand}`}
                label="Pipeline"
                leftSection={<IconLayoutKanban size={18} />}
                active={pathname === `/sales/${currentBrand}`}
                onClick={close}
              />
              <NavLink
                component={Link}
                href={`/salessettings/${currentBrand}`}
                label="Sales Settings"
                leftSection={<IconSettings size={18} />}
                active={pathname === `/salessettings/${currentBrand}`}
                onClick={close}
              />
              <Divider my="xs" />
            </>
          )}

          <Text size="xs" fw={600} c="dimmed" tt="uppercase">
            Reporting
          </Text>
          <NavLink
            component={Link}
            href="/forecast"
            label="Forecast"
            leftSection={<IconChartBar size={18} />}
            active={pathname === '/forecast'}
            onClick={close}
          />
          <NavLink
            component={Link}
            href="/battlecards"
            label="Battlecards"
            leftSection={<IconCards size={18} />}
            active={pathname === '/battlecards'}
            onClick={close}
          />
          <NavLink
            component={Link}
            href="/outreach/templates"
            label="Outreach Templates"
            leftSection={<IconMail size={18} />}
            active={pathname === '/outreach/templates'}
            onClick={close}
          />
        </Stack>
      </Drawer>
    </>
  );
}
