'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import type { Lead } from './types';
import { iceTone, regionTone, qualityTone } from './theme/semantic';
import { semanticToneToMantineColor } from './utils/semantic-colors';

interface LeadCardProps {
  lead: Lead;
  isDragging?: boolean;
  onClick?: () => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}

export function LeadCard({ lead, isDragging = false, onClick, onDragStart, onDragEnd }: LeadCardProps) {
  const ice = (lead.ice?.impact || 0) * (lead.ice?.confidence || 0) * (lead.ice?.ease || 0);
  const region = lead.region || 'US';
  const quality = lead.qualityStatus || 'DRAFT';

  const iceColor = semanticToneToMantineColor(iceTone(ice));
  const regionColor = semanticToneToMantineColor(regionTone[region]);
  const qualityColor = semanticToneToMantineColor(qualityTone[quality] || 'neutral');

  return (
    <div
      onClick={onClick}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        const startX = e.clientX;
        const startY = e.clientY;
        let moved = false;

        function onMove(ev: PointerEvent) {
          if (Math.abs(ev.clientX - startX) > 8 || Math.abs(ev.clientY - startY) > 8) {
            moved = true;
            onDragStart?.();
            document.body.style.userSelect = 'none';
            document.body.style.touchAction = 'none';
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
          }
        }

        function onUp(ev: PointerEvent) {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          document.body.style.userSelect = '';
          document.body.style.touchAction = '';

          if (!moved) {
            // It's a tap — open detail
            onClick?.();
          } else {
            // It was a drag — process drop
            const el = document.elementFromPoint(ev.clientX, ev.clientY);
            const colEl = el?.closest('[data-column]');
            const targetCol = colEl?.getAttribute('data-column');
            if (targetCol && targetCol !== lead.kanbanColumn) {
              (window as any).__pendingDrop = { leadId: lead._id, toColumn: targetCol };
            }
            onDragEnd?.();
          }
        }

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      }}
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
        opacity: isDragging ? 0.35 : 1,
        transform: isDragging ? 'scale(0.96)' : 'scale(1)',
        transition: 'opacity 0.12s, transform 0.12s, background-color 0.12s',
      }}
    >
      {/* Name — single line, bold */}
      <div style={{
        fontSize: '0.82rem',
        fontWeight: 600,
        color: 'var(--mantine-color-gray-9)',
        marginBottom: '0.3rem',
        lineHeight: 1.25,
        wordBreak: 'break-word',
      }}>
        {lead.entity_name}
      </div>

      {/* Badges */}
      <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{
          padding: '0.15rem 0.4rem',
          borderRadius: '0.2rem',
          backgroundColor: `var(--mantine-color-${iceColor}-1)`,
          color: `var(--mantine-color-${iceColor}-9)`,
          fontSize: '0.68rem',
          fontWeight: 700,
          lineHeight: 1.3,
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
    </div>
  );
}
