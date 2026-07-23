'use client';

import { AdminResourceCard } from '@sovereignsquad/gds-admin/client';
import type { Lead } from './types';
import { getIceScore } from './constants';
import { ErrorBoundary } from '@/app/components/ErrorBoundary';

type LeadCardProps = {
  lead: Lead;
  onOpen?: () => void;
};

export function LeadCard({ lead, onOpen }: LeadCardProps) {
  const ice = getIceScore(lead);
  const region = lead.region || 'NA';
  const quality = lead.qualityStatus || 'DRAFT';

  const record = {
    id: lead._id,
    title: lead.entity_name,
    entity_name: lead.entity_name,
    description: lead.industry || lead.sport_or_sector || '',
    metadata: [
      { label: 'Region', value: region },
      ...(lead.size ? [{ label: 'Size', value: lead.size }] : []),
    ],
    ice,
    region,
    quality,
    status: lead.status,
    decision_maker_name: lead.decision_maker_name,
    decision_maker_title: lead.decision_maker_title,
  };

  return (
    <ErrorBoundary>
      <AdminResourceCard
        record={record}
        onPreview={onOpen}
      />
    </ErrorBoundary>
  );
}
