'use client';

import { Suspense, useMemo } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Group, Text, Select, ActionIcon, Tooltip } from '@mantine/core';
import { IconSearch } from '@tabler/icons-react';
import { useCommandLauncher } from '@sovereignsquad/gds-core/client';
import { AppNav } from './AppNav';
import { useAuth } from './AuthProvider';
import type { Brand } from '@/app/lib/brand';

function extractBrandFromPathname(pathname: string, knownBrands: string[]): Brand | null {
  const brandSet = new Set(knownBrands);
  const match = pathname.match(
    /^\/(?:sales|today|contacts|salessettings|forecast|reports|accounts|battlecards|outreach\/[a-z]+|admin\/products|automation|documents)\/([^/?#]+)/
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
  const launcher = useCommandLauncher();

  const brandKeys = useMemo(() => Object.keys(brandLabels), [brandLabels]);
  const activeBrand: Brand = useMemo(() => {
    const fromPath = extractBrandFromPathname(pathname, brandKeys);
    if (fromPath && accessibleBrands.includes(fromPath)) return fromPath;
    return accessibleBrands[0] || 'cogmap';
  }, [pathname, brandKeys, accessibleBrands]);

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
      {/* Left: AppNav hamburger + title */}
      <Group gap="sm" wrap="nowrap" style={{ flexShrink: 0 }}>
        <AppNav />
        <Text fw={700} size="sm" visibleFrom="xs">
          Sales Lead Generator
        </Text>
      </Group>

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
                if (activeBrand && pathname.includes(`/${activeBrand}`)) {
                  router.push(pathname.replace(`/${activeBrand}`, `/${newBrand}`));
                } else {
                  router.push(`/sales/${newBrand}`);
                }
              }
            }}
            visibleFrom="md"
          />
        )}
      </Group>
    </div>
  );
}
