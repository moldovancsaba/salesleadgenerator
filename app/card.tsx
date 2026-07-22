'use client';

import { AdminResourceCard } from '@doneisbetter/gds-admin/client';
import type { Lead } from './types';
import { getIceScore } from './constants';
import { ErrorBoundary } from '@/app/components/ErrorBoundary';

type LeadCardProps = {
  lead: Lead;
  onOpen?: () => void;
};

export function LeadCard({ lead, onOpen }: LeadCardProps) {
  const ice = getIceScore(lead);
  const region = lead.region || 'US';
  const quality = lead.qualityStatus || 'DRAFT';

  const record = {
    id: lead._id,
    title: lead.entity_name,
    entity_name: lead.entity_name,
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
