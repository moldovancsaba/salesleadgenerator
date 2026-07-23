'use client';

import { Button } from '@mantine/core';
import { ProductCard } from '@sovereignsquad/gds-core/client';
import type { Lead } from './types';
import { getIceScore, getTicketSize } from './constants';
import { ErrorBoundary } from '@/app/components/ErrorBoundary';

type LeadCardProps = {
  lead: Lead;
  onOpen?: () => void;
};

export function LeadCard({ lead, onOpen }: LeadCardProps) {
  const ice = getIceScore(lead);
  const region = lead.region || 'NA';
  const quality = lead.qualityStatus || 'DRAFT';
  const ticketSize = getTicketSize(lead);
  const ticketSizeLabel = ticketSize
    ? `${ticketSize.currency === 'USD' ? '$' : '€'}${Math.round(ticketSize.value).toLocaleString()}`
    : null;

  const metadata = [
    { label: 'Region', value: region },
    { label: 'ICE', value: ice },
    ...(ticketSizeLabel ? [{ label: 'Ticket size', value: ticketSizeLabel }] : []),
    ...(lead.size ? [{ label: 'Size', value: lead.size }] : []),
    ...(lead.decision_maker_name ? [{ label: 'Contact', value: lead.decision_maker_name }] : []),
  ];

  return (
    <ErrorBoundary>
      <ProductCard
        title={lead.entity_name}
        description={lead.industry || lead.sport_or_sector || ''}
        status={quality}
        metadata={metadata}
        primaryAction={
          onOpen ? (
            <Button variant="light" size="xs" onClick={onOpen}>
              Preview
            </Button>
          ) : undefined
        }
        density="compact"
        variant="compact"
        size="sm"
      />
    </ErrorBoundary>
  );
}
