'use client';

import { Box, Stack, Text, Title } from './index';
import type { ReactNode } from 'react';
import type { SemanticTone } from '../../theme/semantic';
import { tokens } from '../../theme/tokens';
import { breakpoints } from '../../theme/breakpoints';

/**
 * Page section with optional title and description
 */
export function PageSection({
  title,
  description,
  tone = 'neutral',
  children,
}: {
  title?: string;
  description?: string;
  tone?: SemanticTone;
  children: ReactNode;
}) {
  return (
    <Stack gap={tokens.spacing.lg}>
      {title && (
        <Stack gap={tokens.spacing.xs}>
          <Title order={2} c={`${tone}.${tone === 'neutral' ? 7 : 6}`}>
            {title}
          </Title>
          {description && (
            <Text size="sm" c="dimmed">
              {description}
            </Text>
          )}
        </Stack>
      )}
      {children}
    </Stack>
  );
}

/**
 * Card grid layout
 * Responsive columns using Mantine breakpoints and shared tokens
 */
export function CardGrid({ children }: { children: ReactNode }) {
  return (
    <Box
      style={{
        display: 'grid',
        gap: tokens.spacing.md,
        gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
      }}
    >
      {children}
    </Box>
  );
}

/**
 * Stats card layout
 * For dashboard metrics
 */
export function StatsCard({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string | number;
  tone?: SemanticTone;
}) {
  return (
    <Box
      p="md"
      style={{
        backgroundColor: `var(--mantine-color-${tone}-0)`,
        borderRadius: tokens.radii.md,
        border: '1px solid var(--mantine-color-gray-2)',
      }}
    >
      <Stack gap="xs" align="center">
        <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
          {label}
        </Text>
        <Title order={3} c={`${tone}.7`}>
          {value}
        </Title>
      </Stack>
    </Box>
  );
}
