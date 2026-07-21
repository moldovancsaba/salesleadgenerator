'use client';

import { Badge, type BadgeProps } from '@mantine/core';
import type { SemanticTone } from '../../theme/semantic';
import { semanticToneToMantineColor } from '../../utils/semantic-colors';

export type SemanticBadgeProps = Omit<BadgeProps, 'color'> & {
  tone?: SemanticTone;
  label: string;
};

export function SemanticBadge({ tone = 'neutral', label, ...rest }: SemanticBadgeProps) {
  const color = semanticToneToMantineColor(tone);
  return (
    <Badge color={color} variant="light" size="xs" {...rest}>
      {label}
    </Badge>
  );
}
