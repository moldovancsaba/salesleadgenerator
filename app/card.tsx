'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import type { Lead } from './types';
import { iceTone, regionTone, qualityTone } from './theme/semantic';
import { semanticToneToMantineColor } from './utils/semantic-colors';

interface LeadCardProps {
  lead: Lead;
  onClick?: () => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}

export function LeadCard({ lead, onClick, onDragStart, onDragEnd }: LeadCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  const pointerMoved = useRef(false);

  const ice = (lead.ice?.impact || 0) * (lead.ice?.confidence || 0) * (lead.ice?.ease || 0);
  const region = lead.region || 'UNKNOWN';
  const quality = lead.qualityStatus || 'DRAFT';
  const iceToneValue = iceTone(ice);
  const regionToneValue = regionTone[region];
  const qualityToneValue = qualityTone[quality] || 'neutral';

  const iceColor = semanticToneToMantineColor(iceToneValue);
  const regionColor = semanticToneToMantineColor(regionToneValue);
  const qualityColor = semanticToneToMantineColor(qualityToneValue);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (isDragging) {
        document.body.style.userSelect = 'none';
        document.body.style.webkitUserSelect = 'none';
        document.body.style.touchAction = 'none';
      }
    };
  }, [isDragging]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    // Only handle primary button (left click / touch)
    if (e.button !== 0) return;

    pointerStart.current = { x: e.clientX, y: e.clientY };
    pointerMoved.current = false;

    // Capture pointer for reliable tracking even outside the element
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);

    e.preventDefault();
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!pointerStart.current) return;

    const dx = e.clientX - pointerStart.current.x;
    const dy = e.clientY - pointerStart.current.y;

    // Only start drag after 8px movement — this makes clicks/taps still work
    if (!pointerMoved.current && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
      pointerMoved.current = true;
      setIsDragging(true);
      onDragStart?.();

      // Prevent body scroll and selection during drag
      document.body.style.userSelect = 'none';
      document.body.style.webkitUserSelect = 'none';
      document.body.style.touchAction = 'none';
    }

    if (pointerMoved.current) {
      e.preventDefault();
    }
  }, [onDragStart]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);

    if (pointerMoved.current) {
      // Drag ended — the kanban board's pointerup handler will process the drop
      setTimeout(() => {
        setIsDragging(false);
        pointerMoved.current = false;
        pointerStart.current = null;
        document.body.style.userSelect = '';
        document.body.style.webkitUserSelect = '';
        document.body.style.touchAction = '';
        onDragEnd?.();
      }, 50);
    } else {
      // It was a click, not a drag
      pointerStart.current = null;
    }
  }, [onDragEnd]);

  // Store drag state globally so kanban can access it
  useEffect(() => {
    if (isDragging) {
      (window as any).__cogmapDragData = {
        leadId: lead._id,
        fromColumn: lead.kanbanColumn,
        cardElement: cardRef.current,
      };
    } else {
      delete (window as any).__cogmapDragData;
    }
  }, [isDragging, lead._id, lead.kanbanColumn]);

  return (
    <div
      ref={cardRef}
      onClick={pointerMoved.current ? undefined : onClick}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onContextMenu={(e) => isDragging && e.preventDefault()}
      style={{
        padding: '0.75rem',
        borderRadius: '0.375rem',
        backgroundColor: isDragging ? 'var(--mantine-color-blue-0)' : 'var(--mantine-color-gray-0)',
        border: isDragging ? '2px solid var(--mantine-color-blue-5)' : '1px solid var(--mantine-color-gray-3)',
        cursor: 'grab',
        transition: isDragging ? 'none' : 'box-shadow 0.2s, border-color 0.2s, background-color 0.2s',
        touchAction: 'none',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
        opacity: isDragging ? 0.85 : 1,
        transform: isDragging ? 'scale(1.03)' : 'scale(1)',
        boxShadow: isDragging ? '0 8px 24px rgba(0,0,0,0.2)' : 'none',
        position: 'relative',
        zIndex: isDragging ? 1000 : 1,
      }}
      onMouseEnter={(e) => {
        if (!isDragging && !pointerMoved.current) {
          e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)';
        }
      }}
      onMouseLeave={(e) => {
        if (!isDragging) {
          e.currentTarget.style.boxShadow = 'none';
        }
      }}
    >
      {/* Header */}
      <div style={{ marginBottom: '0.5rem' }}>
        <div style={{
          fontSize: '0.875rem',
          fontWeight: 600,
          color: 'var(--mantine-color-gray-9)',
          marginBottom: '0.25rem'
        }}>
          {lead.entity_name || 'Unknown Entity'}
        </div>
        {lead.url && (
          <div style={{
            fontSize: '0.75rem',
            color: 'var(--mantine-color-gray-6)',
            textOverflow: 'ellipsis',
            overflow: 'hidden',
            whiteSpace: 'nowrap'
          }}>
            {lead.url}
          </div>
        )}
      </div>

      {/* ICE Badge */}
      <div style={{
        display: 'flex',
        gap: '0.5rem',
        marginBottom: '0.5rem'
      }}>
        <div style={{
          padding: '0.25rem 0.5rem',
          borderRadius: '0.25rem',
          backgroundColor: `var(--mantine-color-${iceColor}-1)`,
          color: `var(--mantine-color-${iceColor}-9)`,
          fontSize: '0.75rem',
          fontWeight: 600
        }}>
          ICE: {ice}
        </div>
        <div style={{
          padding: '0.25rem 0.5rem',
          borderRadius: '0.25rem',
          backgroundColor: `var(--mantine-color-${regionColor}-1)`,
          color: `var(--mantine-color-${regionColor}-9)`,
          fontSize: '0.75rem',
          fontWeight: 500
        }}>
          {region}
        </div>
      </div>

      {/* Quality Status */}
      <div style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.25rem',
        fontSize: '0.75rem',
        color: `var(--mantine-color-${qualityColor}-9)`
      }}>
        <span style={{
          display: 'inline-block',
          width: '0.5rem',
          height: '0.5rem',
          borderRadius: '50%',
          backgroundColor: `var(--mantine-color-${qualityColor}-6)`
        }} />
        {quality}
      </div>

      {/* Decision Maker */}
      {lead.decision_maker_name && (
        <div style={{
          marginTop: '0.5rem',
          fontSize: '0.75rem',
          color: 'var(--mantine-color-gray-7)'
        }}>
          DM: {lead.decision_maker_name}
        </div>
      )}
    </div>
  );
}
