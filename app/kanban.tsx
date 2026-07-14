'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { Box, Group, Text, Badge, Card } from '@mantine/core';
import type { Lead, KanbanColumn } from './types';
import { LeadCard } from './card';
import { LeadDetailModal } from './detail';
import { semanticToneToMantineColor } from './utils/semantic-colors';
import { COLUMNS } from './constants';

type BoardProps = {
  leads: Lead[];
  onMove: (leadId: string, column: KanbanColumn, sortOrder: number) => Promise<void>;
};

export function KanbanBoard({ leads, onMove }: BoardProps) {
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [dragOverCol, setDragOverCol] = useState<KanbanColumn | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const dragInfo = useRef<{ leadId: string; fromColumn: KanbanColumn } | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);

  function leadsInColumn(col: KanbanColumn): Lead[] {
    return leads
      .filter((l) => l.kanbanColumn === col)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  }

  useEffect(() => {
    return () => {
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
      document.body.style.userSelect = '';
      document.body.style.webkitUserSelect = '';
      document.body.style.touchAction = '';
    };
  }, []);

  // Global pointer tracking for drag
  useEffect(() => {
    function onPointerMove(e: PointerEvent) {
      if (!dragInfo.current) return;
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el) { setDragOverCol(null); return; }
      const colEl = el.closest('[data-column]');
      const col = colEl?.getAttribute('data-column') as KanbanColumn | null;
      setDragOverCol(col && col !== dragInfo.current.fromColumn ? col : null);
    }

    function onPointerUp(e: PointerEvent) {
      if (!dragInfo.current) return;
      const targetCol = dragOverCol;
      if (targetCol) {
        const colLeads = leadsInColumn(targetCol);
        const newSort = colLeads.length > 0
          ? Math.max(...colLeads.map(l => l.sortOrder ?? 0)) + 10
          : 0;
        onMove(dragInfo.current.leadId, targetCol, newSort);
      }
      dragInfo.current = null;
      setDraggingId(null);
      setDragOverCol(null);
      document.body.style.userSelect = '';
      document.body.style.webkitUserSelect = '';
      document.body.style.touchAction = '';
    }

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [dragOverCol, leadsInColumn, onMove]);

  function handleCardDown(e: React.PointerEvent, lead: Lead) {
    if (e.button !== 0) return;
    e.preventDefault();

    longPressTimer.current = setTimeout(() => {
      dragInfo.current = { leadId: lead._id, fromColumn: lead.kanbanColumn };
      setDraggingId(lead._id);
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      document.body.style.userSelect = 'none';
      document.body.style.webkitUserSelect = 'none';
      document.body.style.touchAction = 'none';
    }, 350);
  }

  function handleCardMove(e: React.PointerEvent) {
    if (longPressTimer.current && !draggingId) {
      if (Math.abs(e.movementX) > 6 || Math.abs(e.movementY) > 6) {
        clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
      }
    }
  }

  function handleCardUp(e: React.PointerEvent, lead: Lead) {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    // If not dragging, it's a tap → open modal
    if (!draggingId) {
      setSelectedLead(lead);
    }
  }

  async function handleAction(leadId: string, action: string, payload: any) {
    try {
      await fetch(`/api/leads?id=${leadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...payload }),
      });
      setSelectedLead(null);
    } catch (err) {
      console.error('Action failed', err);
    }
  }

  return (
    <Box
      ref={boardRef}
      style={{
        display: 'flex',
        gap: '0.6rem',
        overflowX: 'auto',
        overflowY: 'hidden',
        height: '100dvh',
        padding: '0.5rem',
        touchAction: 'pan-y',
        WebkitOverflowScrolling: 'touch',
      }}
    >
      {COLUMNS.map((col) => {
        const colLeads = leadsInColumn(col.key);
        const color = semanticToneToMantineColor(col.color);
        const isDropTarget = dragOverCol === col.key;

        return (
          <Box
            key={col.key}
            data-column={col.key}
            style={{
              flex: '0 0 300px',
              minWidth: 280,
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {/* Column header — fixed */}
            <Box
              style={{
                padding: '0.5rem 0.75rem',
                borderBottom: `2px solid var(--mantine-color-${color}-4)`,
                marginBottom: '0.25rem',
                flexShrink: 0,
              }}
            >
              <Group justify="space-between" align="center" gap="xs">
                <Text fw={700} size="xs" tt="uppercase">{col.label}</Text>
                <Badge variant="light" color={color} size="xs">{colLeads.length}</Badge>
              </Group>
            </Box>

            {/* Cards — scrollable, fills remaining height */}
            <Card
              padding="xs"
              radius="md"
              withBorder
              style={{
                flex: 1,
                overflowY: 'auto',
                overflowX: 'hidden',
                backgroundColor: isDropTarget
                  ? `var(--mantine-color-${color}-1)`
                  : 'var(--mantine-color-gray-0)',
                border: isDropTarget
                  ? `2px dashed var(--mantine-color-${color}-5)`
                  : undefined,
                transition: 'background-color 0.15s',
                WebkitOverflowScrolling: 'touch',
                touchAction: 'pan-y',
              }}
            >
              {colLeads.length === 0 ? (
                <Text size="xs" c="dimmed" ta="center" py="xl">
                  {col.description}
                </Text>
              ) : (
                <Box style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  {colLeads.map((lead) => {
                    const dragging = draggingId === lead._id;
                    return (
                      <Box
                        key={lead._id}
                        onPointerDown={(e) => handleCardDown(e, lead)}
                        onPointerMove={handleCardMove}
                        onPointerUp={(e) => handleCardUp(e, lead)}
                        style={{
                          opacity: dragging ? 0.3 : 1,
                          transition: 'opacity 0.1s',
                        }}
                      >
                        <LeadCard lead={lead} isDragging={dragging} />
                      </Box>
                    );
                  })}
                </Box>
              )}
            </Card>
          </Box>
        );
      })}

      {selectedLead && (
        <LeadDetailModal
          lead={selectedLead}
          onClose={() => setSelectedLead(null)}
          onAction={handleAction}
          onUpdated={() => setSelectedLead(null)}
        />
      )}
    </Box>
  );
}
