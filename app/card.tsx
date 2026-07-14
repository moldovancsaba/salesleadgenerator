'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import type { Lead } from './types';
import { iceTone, regionTone, qualityTone } from './theme/semantic';
import { semanticToneToMantineColor } from './utils/semantic-colors';

interface LeadCardProps {
  lead: Lead;
  isDragging?: boolean;
}

export function LeadCard({ lead, isDragging = false }: LeadCardProps) {
  const ice = (lead.ice?.impact || 0) * (lead.ice?.confidence || 0) * (lead.ice?.ease || 0);
  const region = lead.region || 'US';
  const quality = lead.qualityStatus || 'DRAFT';

  const iceColor = semanticToneToMantineColor(iceTone(ice));
  const regionColor = semanticToneToMantineColor(regionTone[region]);
  const qualityColor = semanticToneToMantineColor(qualityTone[quality] || 'neutral');

  return (
    <div
      style={{
        padding: '0.6rem 0.7rem',
        borderRadius: '0.4rem',
        backgroundColor: isDragging ? 'var(--mantine-color-blue-0)' : 'var(--mantine-color-gray-0)',
        border: isDragging
          ? '2px solid var(--mantine-color-blue-5)'
          : '1px solid var(--mantine-color-gray-3)',
        cursor: 'grab',
        touchAction: 'none',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
        opacity: isDragging ? 0.4 : 1,
        transition: 'opacity 0.1s, background-color 0.1s',
      }}
    >
      {/* Name */}
      <div style={{
        fontSize: '0.82rem',
        fontWeight: 600,
        color: 'var(--mantine-color-gray-9)',
        marginBottom: '0.35rem',
        lineHeight: 1.3,
        wordBreak: 'break-word',
      }}>
        {lead.entity_name}
      </div>

      {/* Badges */}
      <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
        <span style={{
          padding: '0.15rem 0.4rem',
          borderRadius: '0.2rem',
          backgroundColor: `var(--mantine-color-${iceColor}-1)`,
          color: `var(--mantine-color-${iceColor}-9)`,
          fontSize: '0.68rem',
          fontWeight: 600,
        }}>
          {ice}
        </span>
        <span style={{
          padding: '0.15rem 0.4rem',
          borderRadius: '0.2rem',
          backgroundColor: `var(--mantine-color-${regionColor}-1)`,
          color: `var(--mantine-color-${regionColor}-9)`,
          fontSize: '0.68rem',
          fontWeight: 500,
        }}>
          {region}
        </span>
        <span style={{
          padding: '0.15rem 0.4rem',
          borderRadius: '0.2rem',
          backgroundColor: `var(--mantine-color-${qualityColor}-1)`,
          color: `var(--mantine-color-${qualityColor}-9)`,
          fontSize: '0.68rem',
          fontWeight: 500,
        }}>
          {quality}
        </span>
      </div>

      {/* DM — only if exists */}
      {lead.decision_maker_name && (
        <div style={{
          marginTop: '0.3rem',
          fontSize: '0.68rem',
          color: 'var(--mantine-color-gray-6)',
          lineHeight: 1.3,
        }}>
          {lead.decision_maker_name}
          {lead.decision_maker_title && <span style={{ opacity: 0.7 }}> — {lead.decision_maker_title}</span>}
        </div>
      )}
    </div>
  );
}
