import { Box, Group, Text, ActionIcon } from '@mantine/core';
import type { ReactNode } from 'react';
import { tokens } from '../../theme/tokens';
import { semanticToneToMantineColor } from '../../utils/semantic-colors';
import type { SemanticTone } from '../../theme/semantic';
import { IconChevronDown, IconChevronRight } from '@tabler/icons-react';

type ColumnHeaderProps = {
  label: string;
  count: number;
  tone: string;
  collapsed?: boolean;
  onToggle?: () => void;
  rightSection?: ReactNode;
};

export function ColumnHeader({ label, count, tone, collapsed = false, onToggle, rightSection }: ColumnHeaderProps) {
  const safeTone = /^[a-z]+$/.test(tone) ? (tone as SemanticTone) : 'neutral';
  const color = semanticToneToMantineColor(safeTone);

  return (
    <Box
      style={{
        padding: `${tokens.spacing.xs} ${tokens.spacing.md}`,
        borderBottom: '1px solid var(--mantine-color-gray-2)',
        borderTopLeftRadius: tokens.radii.md,
        borderTopRightRadius: tokens.radii.md,
        backgroundColor: color,
        color: '#fff',
        flexShrink: 0,
      }}
    >
      <Group justify="space-between" align="center" gap="xs">
        <Text fw={700} size="sm">
          {label} ({count})
        </Text>
        {onToggle ? (
          <ActionIcon
            size="xs"
            variant="subtle"
            color="white"
            onClick={onToggle}
            aria-label={collapsed ? 'Expand column' : 'Collapse column'}
          >
            {collapsed ? <IconChevronRight size={16} /> : <IconChevronDown size={16} />}
          </ActionIcon>
        ) : (
          rightSection
        )}
      </Group>
    </Box>
  );
}
