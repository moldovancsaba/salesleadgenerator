'use client';

import { useState, useRef, useEffect } from 'react';
import { Box, Text, Badge } from '@mantine/core';
import type { Lead, KanbanColumn } from './types';
import { LeadCard } from './card';
import { semanticToneToMantineColor } from './utils/semantic-colors';
import { COLUMNS } from './constants';

type BoardProps = {
  leads: Lead[];
  onMove: (leadId: string, column: KanbanColumn, sortOrder: number) => Promise<void>;
  onOpenLead: (lead: Lead) => void;
};

export function KanbanBoard({ leads, onMove, onOpenLead }: BoardProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [vertical, setVertical] = useState(false);
  const boardRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    leadId: string;
    startX: number;
    startY: number;
    ghost: HTMLDivElement | null;
    sourceColumn: KanbanColumn;
  } | null>(null);

  function leadsInColumn(col: KanbanColumn): Lead[] {
    return leads
      .filter((l) => l.kanbanColumn === col)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  }

  const handleDragStart = (e: React.PointerEvent, leadId: string, column: KanbanColumn) => {
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    target.style.opacity = '0.4';

    dragRef.current = {
      leadId,
      startX: e.clientX,
      startY: e.clientY,
      ghost: null,
      sourceColumn: column,
    };
  };

  const handleDragMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;

    const deltaX = e.clientX - dragRef.current.startX;
    const deltaY = e.clientY - dragRef.current.startY;

    if (!dragRef.current.ghost && (Math.abs(deltaX) > 10 || Math.abs(deltaY) > 10)) {
      const target = e.currentTarget as HTMLElement;
      const rect = target.getBoundingClientRect();
      const ghost = target.cloneNode(true) as HTMLDivElement;
      ghost.style.position = 'fixed';
      ghost.style.left = rect.left + 'px';
      ghost.style.top = rect.top + 'px';
      ghost.style.width = rect.width + 'px';
      ghost.style.zIndex = '9999';
      ghost.style.opacity = '0.9';
      ghost.style.pointerEvents = 'none';
      ghost.style.transform = 'scale(1.05)';
      ghost.style.boxShadow = '0 10px 30px rgba(0,0,0,0.2)';
      ghost.style.transition = 'transform 0.1s';
      document.body.appendChild(ghost);
      dragRef.current.ghost = ghost;
    }

    if (dragRef.current.ghost) {
      dragRef.current.ghost.style.left = (e.clientX - 20) + 'px';
      dragRef.current.ghost.style.top = (e.clientY - 20) + 'px';
    }
  };

  const handleDragEnd = async (e: React.PointerEvent, column: KanbanColumn) => {
    const target = e.currentTarget as HTMLElement;
    target.style.opacity = '1';

    if (dragRef.current?.ghost) {
      dragRef.current.ghost.remove();
    }

    if (!dragRef.current) return;

    const dropTarget = document.elementFromPoint(e.clientX, e.clientY);
    const dropColumn = dropTarget?.closest('[data-column]');
    const targetColumn = dropColumn?.getAttribute('data-column') as KanbanColumn | undefined;

    if (targetColumn && targetColumn !== dragRef.current.sourceColumn) {
      const colLeads = leadsInColumn(targetColumn);
      const sortOrder = colLeads.length > 0 ? Math.max(...colLeads.map((l) => l.sortOrder ?? 0)) + 1 : 0;
      await onMove(dragRef.current.leadId, targetColumn, sortOrder);
    }

    dragRef.current = null;
    setIsDragging(false);
  };

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'ArrowLeft') {
        boardRef.current?.scrollBy({ left: -320, behavior: 'smooth' });
      }
      if (e.key === 'ArrowRight') {
        boardRef.current?.scrollBy({ left: 320, behavior: 'smooth' });
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    const mql = window.matchMedia('(max-width: 767px)');
    setVertical(mql.matches);
    const handler = (event: MediaQueryListEvent) => setVertical(event.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  return (
    <Box
      ref={boardRef}
      className={`kanban-board ${vertical ? 'kanban-board--vertical' : 'kanban-board--horizontal'}`}
    >
      {COLUMNS.map((col) => {
        const colLeads = leadsInColumn(col.key);
        const color = semanticToneToMantineColor(col.color);

        return (
          <Box
            key={col.key}
            data-column={col.key}
            className={`kanban-column ${vertical ? 'kanban-column--vertical' : 'kanban-column--horizontal'}`}
          >
            <Box
              style={{
                padding: '0.5rem 0.75rem',
                borderBottom: '1px solid var(--mantine-color-gray-2)',
                borderTopLeftRadius: '0.5rem',
                borderTopRightRadius: '0.5rem',
                backgroundColor: color,
                color: '#fff',
                flexShrink: 0,
              }}
            >
              <Text fw={700} size="sm">{col.label}</Text>
            </Box>

            <Box
              className="kanban-column-body"
              style={{
                // keeps existing padding/gap through CSS class
              }}
            >
              {colLeads.map((lead) => (
                <LeadCard
                  key={lead._id}
                  lead={lead}
                  onOpen={() => onOpenLead(lead)}
                  onMoveStart={(e) => handleDragStart(e, lead._id, col.key)}
                  onMove={handleDragMove}
                  onMoveEnd={(e) => handleDragEnd(e, col.key)}
                  isDragging={isDragging}
                />
              ))}
              {!colLeads.length && (
                <Text size="xs" c="dimmed" ta="center" py="md">
                  No leads
                </Text>
              )}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}
