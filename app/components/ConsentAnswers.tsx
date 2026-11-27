'use client';

import { Stack, Text } from '@mantine/core';
import { formatConsentValue, type LeadConsentEntry } from '@/lib/lead-consents';

/**
 * One person's consent answers as wrapping lines. The answer comes first and nothing is
 * truncated, so a long question can never hide whether the person said yes or no.
 */
export function ConsentAnswers({ consents, size = '11px' }: { consents: ReadonlyArray<LeadConsentEntry>; size?: string }) {
  if (consents.length === 0) return null;
  return (
    <Stack gap={2}>
      {consents.map((consent) => (
        <Text key={consent.label} size={size} style={{ overflowWrap: 'anywhere' }}>
          <Text span inherit fw={700}>
            {formatConsentValue(consent.value) || '—'}
          </Text>
          {' · '}
          {consent.label}
        </Text>
      ))}
    </Stack>
  );
}
