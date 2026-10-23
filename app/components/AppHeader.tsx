'use client';

import { Suspense, useMemo, useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Group, Text, Select, ActionIcon, Tooltip, Button, Indicator } from '@mantine/core';
import {
  IconSearch,
  IconCalendarTime,
  IconInbox,
  IconLayoutKanban,
  IconAddressBook,
  IconBuildings,
  IconTrendingUp,
  IconReportAnalytics,
  IconSparkles,
} from '@tabler/icons-react';
import { useCommandLauncher } from '@sovereignsquad/gds-core/client';
import { AppNav } from './AppNav';
import { useAuth } from './AuthProvider';
import { useNav } from './NavContext';
import type { Brand } from '@/app/lib/brand';
import { APP_VERSION } from '@/lib/release-notes-dates';

function extractBrandFromPathname(pathname: string, knownBrands: string[]): Brand | null {
  const brandSet = new Set(knownBrands);
  const match = pathname.match(
    /^\/(?:sales|today|inbox|contacts|whats-new|salessettings|forecast|reports|accounts|battlecards|outreach\/[a-z]+|admin\/products|automation|documents)\/([^/?#]+)/
  );
  if (match && brandSet.has(match[1])) {
    return match[1] as Brand;
  }
  return null;
}

export function AppHeader() {
  const pathname = usePathname();
  if (pathname?.startsWith('/schedule/') || pathname?.startsWith('/quotes/') || pathname?.startsWith('/forms/')) return null;

  return (
    <Suspense
      fallback={
        <div
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 100,
            background: 'var(--mantine-color-body)',
            borderBottom: '1px solid var(--mantine-color-gray-3)',
            padding: '6px 14px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            height: '48px',
            boxSizing: 'border-box',
          }}
        >
          <AppNav />
          <span style={{ fontWeight: 700, fontSize: '15px' }}>Sales Lead Generator</span>
        </div>
      }
    >
      <AppHeaderInner />
    </Suspense>
  );
}

function AppHeaderInner() {
  const pathname = usePathname();
  const router = useRouter();
  const { accessibleBrands, brandLabels } = useAuth();
  const { sidebarOpen, isDesktopOrTablet } = useNav();
  const launcher = useCommandLauncher();
  const [hasNewRelease, setHasNewRelease] = useState(false);

  useEffect(() => {
    try {
      const seen = localStorage.getItem('slg_seen_version');
      if (seen !== APP_VERSION) {
        setHasNewRelease(true);
      } else {
        setHasNewRelease(false);
      }
    } catch {
      // Safe fallback
    }
  }, [pathname]);

  const brandKeys = useMemo(() => Object.keys(brandLabels), [brandLabels]);
  const activeBrand: Brand = useMemo(() => {
    const fromPath = extractBrandFromPathname(pathname, brandKeys);
    if (fromPath && accessibleBrands.includes(fromPath)) return fromPath;
    return accessibleBrands[0] || 'cogmap';
  }, [pathname, brandKeys, accessibleBrands]);

  const navItems = useMemo(() => {
    if (!activeBrand) return [];
    return [
      { label: 'Today', href: `/today/${activeBrand}`, icon: IconCalendarTime },
      { label: 'Inbox', href: `/inbox/${activeBrand}`, icon: IconInbox },
      { label: 'Pipeline', href: `/sales/${activeBrand}`, icon: IconLayoutKanban },
      { label: 'Contacts', href: `/contacts/${activeBrand}`, icon: IconAddressBook },
      { label: 'Accounts', href: `/accounts/${activeBrand}`, icon: IconBuildings },
      { label: 'Forecast', href: `/forecast/${activeBrand}`, icon: IconTrendingUp },
      { label: 'Reports', href: `/reports/${activeBrand}`, icon: IconReportAnalytics },
    ];
  }, [activeBrand]);

  return (
    <div
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 100,
        background: 'var(--mantine-color-body)',
        borderBottom: '1px solid var(--mantine-color-gray-3)',
        padding: '6px 14px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px',
        height: '48px',
        boxSizing: 'border-box',
      }}
    >
      {/* Left: AppNav hamburger + title + version badge */}
      <Group gap="xs" wrap="nowrap" style={{ flexShrink: 0 }}>
        <AppNav />
        <Text fw={700} size="sm" visibleFrom="xs">
          Sales Lead Generator
        </Text>
        <Tooltip label={`What's New in v${APP_VERSION}`}>
          <Button
            component={Link}
            href={`/whats-new/${activeBrand}`}
            variant="light"
            color="indigo"
            size="compact-xs"
            style={{ fontSize: '11px', fontWeight: 700, padding: '0 6px', height: '20px' }}
          >
            v{APP_VERSION}
          </Button>
        </Tooltip>
      </Group>

      {/* Center: Desktop horizontal navigation links (only rendered when sidebar is collapsed to eliminate duplication) */}
      {!sidebarOpen && accessibleBrands.length > 0 && (
        <Group
          gap={4}
          wrap="nowrap"
          visibleFrom="md"
          style={{ flex: 1, justifyContent: 'center', minWidth: 0, overflow: 'hidden' }}
        >
          {navItems.map((item) => {
            const active = pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Button
                key={item.label}
                component={Link}
                href={item.href}
                size="compact-xs"
                variant={active ? 'light' : 'subtle'}
                color={active ? 'indigo' : 'gray'}
                leftSection={<Icon size={14} />}
                style={{
                  fontWeight: active ? 700 : 500,
                  fontSize: '12px',
                  borderRadius: '6px',
                }}
              >
                {item.label}
              </Button>
            );
          })}
        </Group>
      )}

      {/* Right: What's New + Quick Command Search + Organization switcher */}
      <Group gap="xs" wrap="nowrap" style={{ flexShrink: 0 }}>
        <Tooltip label="What's New & Release Notes">
          <Indicator disabled={!hasNewRelease} size={8} color="indigo" offset={2}>
            <ActionIcon
              component={Link}
              href={`/whats-new/${activeBrand}`}
              variant={pathname.startsWith('/whats-new') ? 'filled' : 'default'}
              color="indigo"
              size="md"
              aria-label="What's New & Release Notes"
            >
              <IconSparkles size={16} color={pathname.startsWith('/whats-new') ? 'white' : 'var(--mantine-color-indigo-6)'} />
            </ActionIcon>
          </Indicator>
        </Tooltip>

        <Tooltip label="Search or command palette (⌘K)">
          <ActionIcon
            variant="default"
            size="md"
            aria-label="Open command palette"
            onClick={() => launcher.open()}
            visibleFrom="sm"
          >
            <IconSearch size={16} />
          </ActionIcon>
        </Tooltip>

        {accessibleBrands.length > 1 && !(sidebarOpen && isDesktopOrTablet) && (
          <Select
            size="xs"
            w={120}
            aria-label="Select active brand"
            value={activeBrand}
            data={accessibleBrands.map((b) => ({
              value: b,
              label: brandLabels[b] || b,
            }))}
            onChange={(newBrand) => {
              if (newBrand) {
                if (activeBrand && pathname.includes(`/${activeBrand}`)) {
                  router.push(pathname.replace(`/${activeBrand}`, `/${newBrand}`));
                } else {
                  router.push(`/sales/${newBrand}`);
                }
              }
            }}
            visibleFrom="xs"
          />
        )}
      </Group>
    </div>
  );
}
