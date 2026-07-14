'use client';

import { useRef, useState, useCallback } from 'react';
import type { Lead } from './types';
import { iceTone, regionTone, qualityTone } from './theme/semantic';
import { semanticToneToMantineColor } from './utils/semantic-colors';

interface LeadCardProps {
  lead: Lead;
  onClick?: () => void;
  onDragStart?: () => void;
}

export function LeadCard({ lead, onClick, onDragStart }: LeadCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [touchStart, setTouchStart] = useState<{ x: number; y: number; time: number } | null>(null);

  const ice = (lead.ice?.impact || 0) * (lead.ice?.confidence || 0) * (lead.ice?.ease || 0);
  const region = lead.region || 'UNKNOWN';
  const quality = lead.qualityStatus || 'DRAFT';
  const iceToneValue = iceTone(ice);
  const regionToneValue = regionTone[region];
  const qualityToneValue = qualityTone[quality] || 'neutral';

  const iceColor = semanticToneToMantineColor(iceToneValue);
  const regionColor = semanticToneToMantineColor(regionToneValue);
  const qualityColor = semanticToneToMantineColor(qualityToneValue);

  // Prevent context menu on long press (causes search on mobile)
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
  }, []);

  // Touch handlers for mobile drag
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    setTouchStart({ x: touch.clientX, y: touch.clientY, time: Date.now() });
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!touchStart) return;
    const touch = e.touches[0];
    const dx = touch.clientX - touchStart.x;
    const dy = touch.clientY - touchStart.y;

    // If moved more than 10px, consider it a drag
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
      setIsDragging(true);
      // Prevent scrolling while dragging
      e.preventDefault();
    }
  }, [touchStart]);

  const handleTouchEnd = useCallback(() => {
    if (isDragging) {
      // Touch drag ended — the drop zone handler will deal with it
      setTimeout(() => setIsDragging(false), 100);
    }
    setTouchStart(null);
  }, [isDragging]);

  function handleDragStart(e: React.DragEvent) {
    e.dataTransfer.setData('text/plain', JSON.stringify({ index: 0 }));
    e.dataTransfer.effectAllowed = 'move';
    // Set a transparent drag image for cleaner UX
    const img = new Image();
    img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    e.dataTransfer.setDragImage(img, 0, 0);
    onDragStart?.();
  }

  return (
    <div
      ref={cardRef}
      onClick={onClick}
      draggable
      onDragStart={handleDragStart}
      onContextMenu={handleContextMenu}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={{
        padding: '0.75rem',
        borderRadius: '0.375rem',
        backgroundColor: isDragging ? 'var(--mantine-color-blue-0)' : 'var(--mantine-color-gray-0)',
        border: isDragging ? '2px solid var(--mantine-color-blue-5)' : '1px solid var(--mantine-color-gray-3)',
        cursor: 'pointer',
        transition: 'box-shadow 0.2s, border-color 0.2s, background-color 0.2s',
        touchAction: 'none', // Prevent browser gestures on touch
        userSelect: 'none', // Prevent text selection during drag
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none', // Prevent iOS callout menu
        opacity: isDragging ? 0.7 : 1,
        transform: isDragging ? 'scale(1.02)' : 'scale(1)',
      }}
      onMouseEnter={(e) => {
        if (!isDragging) {
          e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)';
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = 'none';
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
