import { Group, Button, TextInput } from '@mantine/core';
import type { ReactNode } from 'react';
import { tokens } from '../../theme/tokens';

type FilterBarProps = {
  children: ReactNode;
};

export function FilterBar({ children }: FilterBarProps) {
  return (
    <Group
      justify="space-between"
      align="center"
      wrap="wrap"
      gap="xs"
      style={{
        padding: tokens.spacing.sm,
        borderBottom: '1px solid var(--mantine-color-gray-2)',
        backgroundColor: 'var(--mantine-color-gray-0)',
        flexShrink: 0,
        position: 'sticky',
        top: 0,
        zIndex: 10,
      }}
    >
      {children}
    </Group>
  );
}
