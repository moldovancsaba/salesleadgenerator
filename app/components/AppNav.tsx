'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { ActionIcon, Drawer, NavLink, Stack, Divider, Text } from '@mantine/core';
import { IconMenu2, IconLayoutKanban, IconChartBar, IconCards, IconMail, IconSettings } from '@tabler/icons-react';
import { BRAND_CONFIG } from '@/app/lib/brand';

// Issue #95: this app had no persistent in-app navigation anywhere — every
// page (including Sales Settings) was only reachable by typing its URL
// directly. This is the single nav surface for the whole app, mounted once
// in the root layout so it's present on every page. Forecast/Battlecards/
// Outreach Templates are brand-agnostic single pages (no [brand] segment in
// their own routes — each handles brand-switching internally); Kanban and
// Sales Settings are per-brand, so both configured brands get their own
// link rather than guessing which one the operator wants.
const BRANDS = Object.keys(BRAND_CONFIG) as Array<keyof typeof BRAND_CONFIG>;

export function AppNav() {
  const [opened, setOpened] = useState(false);
  const pathname = usePathname();

  const close = () => setOpened(false);

  return (
    <>
      <ActionIcon
        variant="subtle"
        color="gray"
        size="lg"
        aria-label="Open navigation menu"
        onClick={() => setOpened(true)}
      >
        <IconMenu2 size={22} />
      </ActionIcon>
      <Drawer
        opened={opened}
        onClose={close}
        title={<Text fw={700} size="lg">Sales Lead Generator</Text>}
        padding="md"
        size="xs"
      >
        <Stack gap={4}>
          <Text size="xs" fw={600} c="dimmed" tt="uppercase" mt={4}>
            Pipeline
          </Text>
          {BRANDS.map((brand) => (
            <NavLink
              key={brand}
              component={Link}
              href={`/sales/${brand}`}
              label={BRAND_CONFIG[brand].label}
              leftSection={<IconLayoutKanban size={18} />}
              active={pathname === `/sales/${brand}`}
              onClick={close}
            />
          ))}

          <Divider my="xs" />
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

          <Divider my="xs" />
          <Text size="xs" fw={600} c="dimmed" tt="uppercase">
            Sales Settings
          </Text>
          {BRANDS.map((brand) => (
            <NavLink
              key={brand}
              component={Link}
              href={`/salessettings/${brand}`}
              label={`${BRAND_CONFIG[brand].label} Settings`}
              leftSection={<IconSettings size={18} />}
              active={pathname === `/salessettings/${brand}`}
              onClick={close}
            />
          ))}
        </Stack>
      </Drawer>
    </>
  );
}
