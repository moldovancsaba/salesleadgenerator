'use client';

import type { Lead } from './types';
import { iceTone, regionTone, qualityTone } from './theme/semantic';
import { semanticToneToMantineColor } from './utils/semantic-colors';

interface LeadCardProps {
  lead: Lead;
  onOpen?: () => void;
  onMoveStart?: (e: React.PointerEvent) => void;
  onMove?: (e: React.PointerEvent) => void;
  onMoveEnd?: (e: React.PointerEvent) => void;
  isDragging?: boolean;
}

export function LeadCard({ lead, onOpen, onMoveStart, onMove, onMoveEnd, isDragging = false }: LeadCardProps) {
  const ice = (lead.ice?.impact || 0) * (lead.ice?.confidence || 0) * (lead.ice?.ease || 0);
  const region = lead.region || 'US';
  const quality = lead.qualityStatus || 'DRAFT';

  const iceColor = semanticToneToMantineColor(iceTone(ice));
  const regionColor = semanticToneToMantineColor(regionTone[region]);
  const qualityColor = semanticToneToMantineColor(qualityTone[quality] || 'neutral');

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '0.5rem',
        padding: '0.7rem 0.75rem',
        borderRadius: '0.5rem',
        backgroundColor: 'var(--mantine-color-white)',
        border: '1px solid var(--mantine-color-gray-3)',
        cursor: 'grab',
        touchAction: 'none',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
        transition: 'transform 0.1s, box-shadow 0.1s',
      }}
    >
      {/* Grip handle */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          paddingTop: '0.1rem',
          color: 'var(--mantine-color-gray-4)',
          cursor: 'grab',
          flexShrink: 0,
        }}
      >
        <svg width="12" height="16" viewBox="0 0 12 16" fill="none" style={{ display: 'block' }}>
          <circle cx="4" cy="3" r="1.5" fill="currentColor" />
          <circle cx="8" cy="3" r="1.5" fill="currentColor" />
          <circle cx="4" cy="8" r="1.5" fill="currentColor" />
          <circle cx="8" cy="8" r="1.5" fill="currentColor" />
          <circle cx="4" cy="13" r="1.5" fill="currentColor" />
          <circle cx="8" cy="13" r="1.5" fill="currentColor" />
        </svg>
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Name */}
        <div style={{
          fontSize: '0.9rem',
          fontWeight: 600,
          color: 'var(--mantine-color-gray-9)',
          marginBottom: '0.4rem',
          lineHeight: 1.3,
          wordBreak: 'break-word',
        }}>
          {lead.entity_name}
        </div>

        {/* Badges */}
        <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{
            padding: '0.18rem 0.45rem',
            borderRadius: '0.25rem',
            backgroundColor: `var(--mantine-color-${iceColor}-1)`,
            color: `var(--mantine-color-${iceColor}-9)`,
            fontSize: '0.72rem',
            fontWeight: 700,
          }}>
            {ice}
          </span>
          <span style={{
            padding: '0.18rem 0.45rem',
            borderRadius: '0.25rem',
            backgroundColor: `var(--mantine-color-${regionColor}-1)`,
            color: `var(--mantine-color-${regionColor}-9)`,
            fontSize: '0.72rem',
            fontWeight: 500,
          }}>
            {region}
          </span>
          <span style={{
            padding: '0.18rem 0.45rem',
            borderRadius: '0.25rem',
            backgroundColor: `var(--mantine-color-${qualityColor}-1)`,
            color: `var(--mantine-color-${qualityColor}-9)`,
            fontSize: '0.72rem',
            fontWeight: 500,
          }}>
            {quality}
          </span>
        </div>

        {/* DM if exists */}
        {lead.decision_maker_name && (
          <div style={{
            marginTop: '0.35rem',
            fontSize: '0.72rem',
            color: 'var(--mantine-color-gray-6)',
            lineHeight: 1.3,
          }}>
            {lead.decision_maker_name}
            {lead.decision_maker_title && <span style={{ opacity: 0.7 }}> — {lead.decision_maker_title}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
