import type { MantineColor } from '@mantine/core';

/**
 * Semantic tone mapping to Mantine colors
 * All components should use these instead of hardcoded hex values
 */
export const semanticToneToMantineColor = (tone: string): MantineColor => {
  const mapping: Record<string, MantineColor> = {
    'ingress': 'blue',
    'synthesis': 'green',
    'tactical': 'orange',
    'strategy': 'grape',
    'review': 'red',
    'neutral': 'gray',
  };
  return mapping[tone] || 'gray';
};

export const qualityStatusToMantineColor = (status: string): MantineColor => {
  const mapping: Record<string, MantineColor> = {
    'VERIFIED': 'green',
    'CHECKED': 'yellow',
    'DRAFT': 'gray',
  };
  return mapping[status] || 'gray';
};

export const regionToMantineColor = (region: string): MantineColor => {
  const mapping: Record<string, MantineColor> = {
    'US': 'blue',
    'CEE': 'grape',
    'MENA': 'orange',
  };
  return mapping[region] || 'gray';
};
