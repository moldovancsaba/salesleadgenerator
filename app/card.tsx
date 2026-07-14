'use client';

import { useRef, useEffect } from 'react';
import type { Lead } from './types';
import { iceTone, regionTone, qualityTone } from './theme/semantic';
import { semanticToneToMantineColor } from './utils/semantic-colors';

interface LeadCardProps {
  lead: Lead;
  isDragging?: boolean;
  onClick?: () => void;
  onPointerDown?: (e: React.PointerEvent) => void;
  onPointerMove?: (e: React.PointerEvent) => void;
  onPointerUp?: (e: React.PointerEvent) => void;
}

export function LeadCard({ lead, isDragging = false }: LeadCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);

  const ice = (lead.ice?.impact || 0) * (lead.ice?.confidence || 0) * (lead.ice?.ease || 0);
  const region = lead.region || 'UNKNOWN';
  const quality = lead.qualityStatus || 'DRAFT';
  const iceToneValue = iceTone(ice);
  const regionToneValue = regionTone[region];
  const qualityToneValue = qualityTone[quality] || 'neutral';

  const iceColor = semanticToneToMantineColor(iceToneValue);
  const regionColor = semanticToneToMantineColor(regionToneValue);
  const qualityColor = semanticToneToMantineColor(qualityToneValue);

  useEffect(() => {
    return () => {
      document.body.style.userSelect = '';
      document.body.style.webkitUserSelect = '';
      document.body.style.touchAction = '';
    };
  }, []);

  return (
    <div
      ref={cardRef}
      style={{
        padding: '0.75rem',
        borderRadius: '0.375rem',
        backgroundColor: isDragging ? 'var(--mantine-color-blue-0)' : 'var(--mantine-color-gray-0)',
        border: isDragging ? '2px solid var(--mantine-color-blue-5)' : '1px solid var(--mantine-color-gray-3)',
        cursor: 'grab',
        touchAction: 'none',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
        opacity: isDragging ? 0.85 : 1,
        transform: isDragging ? 'scale(1.02)' : 'scale(1)',
        boxShadow: isDragging ? '0 8px 24px rgba(0,0,0,0.18)' : 'none',
        transition: 'box-shadow 0.2s, border-color 0.2s, background-color 0.2s',
      }}
    >
      {/* Header */}
      <div style={{ marginBottom: '0.5rem' }}>
        <div style={{
          fontSize: '0.875rem',
          fontWeight: 600,
          color: 'var(--mantine-color-gray-9)',
          marginBottom: '0.25rem',
          lineHeight: 1.3,
        }}>
          {lead.entity_name || 'Unknown Entity'}
        </div>
        {lead.url && (
          <div style={{
            fontSize: '0.7rem',
            color: 'var(--mantine-color-gray-5)',
            textOverflow: 'ellipsis',
            overflow: 'hidden',
            whiteSpace: 'nowrap',
            maxWidth: '100%',
          }}>
            {lead.url}
          </div>
        )}
      </div>

      {/* Badges row */}
      <div style={{
        display: 'flex',
        gap: '0.4rem',
        marginBottom: '0.4rem',
        flexWrap: 'wrap',
      }}>
        <span style={{
          padding: '0.2rem 0.45rem',
          borderRadius: '0.25rem',
          backgroundColor: `var(--mantine-color-${iceColor}-1)`,
          color: `var(--mantine-color-${iceColor}-9)`,
          fontSize: '0.7rem',
          fontWeight: 600,
        }}>
          ICE {ice}
        </span>
        <span style={{
          padding: '0.2rem 0.45rem',
          borderRadius: '0.25rem',
          backgroundColor: `var(--mantine-color-${regionColor}-1)`,
          color: `var(--mantine-color-${regionColor}-9)`,
          fontSize: '0.7rem',
          fontWeight: 500,
        }}>
          {region}
        </span>
      </div>

      {/* Quality + DM */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.35rem',
        fontSize: '0.7rem',
        color: `var(--mantine-color-${qualityColor}-9)`,
        marginBottom: lead.decision_maker_name ? '0.35rem' : 0,
      }}>
        <span style={{
          display: 'inline-block',
          width: '0.4rem',
          height: '0.4rem',
          borderRadius: '50%',
          backgroundColor: `var(--mantine-color-${qualityColor}-6)`,
        }} />
        {quality}
      </div>

      {lead.decision_maker_name && (
        <div style={{
          fontSize: '0.7rem',
          color: 'var(--mantine-color-gray-6)',
          lineHeight: 1.4,
        }}>
          <strong>{lead.decision_maker_name}</strong>
          {lead.decision_maker_title && <span> — {lead.decision_maker_title}</span>}
        </div>
      )}

      {lead.contact_phone && (
        <div style={{
          fontSize: '0.65rem',
          color: 'var(--mantine-color-gray-5)',
          marginTop: '0.15rem',
        }}>
          📞 {lead.contact_phone}
        </div>
      )}
    </div>
  );
}
