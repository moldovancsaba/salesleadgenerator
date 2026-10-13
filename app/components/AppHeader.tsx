'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Group, Text, Button, Select, ActionIcon, Tooltip } from '@mantine/core';
import {
  IconSearch,
  IconClock,
  IconLayoutKanban,
  IconTable,
  IconArchive,
  IconAddressBook,
  IconReportAnalytics,
  IconTrendingUp,
  IconSettings,
  IconChevronUp,
  IconChevronDown,
} from '@tabler/icons-react';
import { useCommandLauncher } from '@sovereignsquad/gds-core/client';
import { AppNav } from './AppNav';
import { useAuth } from './AuthProvider';
import type { Brand } from '@/app/lib/brand';

function extractBrandFromPathname(pathname: string, knownBrands: string[]): Brand | null {
  const brandSet = new Set(knownBrands);
  const match = pathname.match(
    /^\/(?:sales|today|contacts|salessettings|forecast|reports|accounts|battlecards|outreach\/[a-z]+|admin\/products)\/([^/?#]+)/
  );
  if (match && brandSet.has(match[1])) {
    return match[1] as Brand;
  }
  return null;
}

export function AppHeader() {
  const pathname = usePathname();
  if (pathname?.startsWith('/schedule/')) return null;

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
            padding: '8px 12px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
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
  const searchParams = useSearchParams();
  const router = useRouter();
  const { accessibleBrands, brandLabels } = useAuth();
  const launcher = useCommandLauncher();

  const brandKeys = useMemo(() => Object.keys(brandLabels), [brandLabels]);
  const activeBrand: Brand = useMemo(() => {
    const fromPath = extractBrandFromPathname(pathname, brandKeys);
    if (fromPath && accessibleBrands.includes(fromPath)) return fromPath;
    return accessibleBrands[0] || 'cogmap';
  }, [pathname, brandKeys, accessibleBrands]);

  const view = searchParams.get('view') || 'kanban';

  const [navVisible, setNavVisible] = useState(true);

  useEffect(() => {
    try {
      const stored = localStorage.getItem('slg_nav_visible');
      if (stored === 'false') {
        setNavVisible(false);
      }
    } catch {
      // Safe fallback if localStorage is disabled/private browsing
    }
  }, []);

  const handleToggleNav = (next: boolean) => {
    setNavVisible(next);
    try {
      localStorage.setItem('slg_nav_visible', String(next));
    } catch {
      // Safe fallback
    }
  };

  const navItems = [
    {
      label: 'Today',
      href: `/today/${activeBrand}`,
      active: pathname.startsWith(`/today/${activeBrand}`),
      icon: IconClock,
    },
    {
      label: 'Pipeline',
      href: `/sales/${activeBrand}`,
      active: pathname === `/sales/${activeBrand}` && view === 'kanban',
      icon: IconLayoutKanban,
    },
    {
      label: 'Table',
      href: `/sales/${activeBrand}?view=table`,
      active: pathname === `/sales/${activeBrand}` && view === 'table',
      icon: IconTable,
    },
    {
      label: 'Backlog',
      href: `/sales/${activeBrand}?view=backlog`,
      active: pathname === `/sales/${activeBrand}` && view === 'backlog',
      icon: IconArchive,
    },
    {
      label: 'Contacts',
      href: `/contacts/${activeBrand}`,
      active: pathname.startsWith(`/contacts/${activeBrand}`),
      icon: IconAddressBook,
    },
    {
      label: 'Reports',
      href: `/reports/${activeBrand}`,
      active: pathname.startsWith(`/reports/${activeBrand}`),
      icon: IconReportAnalytics,
    },
    {
      label: 'Forecast',
      href: `/forecast/${activeBrand}`,
      active: pathname.startsWith(`/forecast/${activeBrand}`),
      icon: IconTrendingUp,
    },
    {
      label: 'Settings',
      href: `/salessettings/${activeBrand}`,
      active: pathname.startsWith(`/salessettings/${activeBrand}`),
      icon: IconSettings,
    },
  ];

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
        minHeight: '48px',
      }}
    >
      {/* Left: AppNav hamburger + title */}
      <Group gap="sm" wrap="nowrap" style={{ flexShrink: 0 }}>
        <AppNav />
        <Text fw={700} size="sm" visibleFrom="xs">
          Sales Lead Generator
        </Text>
      </Group>

      {/* Middle: Horizontal Nav for Tablet & Laptop (visibleFrom="sm", >= 768px) */}
      {navVisible ? (
        <Group
          gap={4}
          wrap="nowrap"
          visibleFrom="sm"
          style={{
            flex: 1,
            overflowX: 'auto',
            justifyContent: 'center',
            scrollbarWidth: 'none',
          }}
        >
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <Button
                key={item.label}
                component={Link}
                href={item.href}
                size="xs"
                variant={item.active ? 'filled' : 'subtle'}
                color={item.active ? 'indigo' : 'gray'}
                leftSection={<Icon size={14} />}
                style={{ flexShrink: 0, fontWeight: item.active ? 600 : 500 }}
                onClick={(e) => {
                  e.preventDefault();
                  router.push(item.href);
                }}
              >
                {item.label}
              </Button>
            );
          })}
          <Tooltip label="Hide navigation bar">
            <ActionIcon
              variant="subtle"
              color="gray"
              size="sm"
              aria-label="Hide navigation bar"
              onClick={() => handleToggleNav(false)}
            >
              <IconChevronUp size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
      ) : (
        <Group gap="xs" wrap="nowrap" visibleFrom="sm" style={{ flex: 1, justifyContent: 'center' }}>
          <Tooltip label="Show navigation bar">
            <Button
              variant="subtle"
              color="gray"
              size="xs"
              leftSection={<IconChevronDown size={14} />}
              onClick={() => handleToggleNav(true)}
              aria-label="Show navigation bar"
            >
              Show Navigation
            </Button>
          </Tooltip>
        </Group>
      )}

      {/* Right: Quick Command Search + Organization switcher */}
      <Group gap="xs" wrap="nowrap" style={{ flexShrink: 0 }}>
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

        {accessibleBrands.length > 1 && (
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
                router.push(`/sales/${newBrand}`);
              }
            }}
            visibleFrom="md"
          />
        )}
      </Group>
    </div>
  );
}
