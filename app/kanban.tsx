'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { Box, Group, Stack, Text, Badge, Card } from '@mantine/core';
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
  const boardRef = useRef<HTMLDivElement>(null);
  const colRefs = useRef<Record<string, HTMLDivElement | null>>({});

  function leadsInColumn(col: KanbanColumn): Lead[] {
    return leads
      .filter((l) => l.kanbanColumn === col)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  }

  // Listen for pointer events from cards using window event system
  useEffect(() => {
    function handleGlobalPointerMove(e: PointerEvent) {
      const dragData = (window as any).__cogmapDragData;
      if (!dragData) return;

      // Find which column the pointer is over
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el) return;

      const colEl = el.closest('[data-column]');
      if (colEl) {
        const col = colEl.getAttribute('data-column') as KanbanColumn;
        if (col && col !== dragData.fromColumn) {
          setDragOverCol(col);
        } else {
          setDragOverCol(null);
        }
      } else {
        setDragOverCol(null);
      }
    }

    function handleGlobalPointerUp(e: PointerEvent) {
      const dragData = (window as any).__cogmapDragData;
      if (!dragData) return;

      // Find drop target
      const el = document.elementFromPoint(e.clientX, e.clientY);
      let targetColumn: KanbanColumn | null = null;

      if (el) {
        const colEl = el.closest('[data-column]');
        if (colEl) {
          targetColumn = colEl.getAttribute('data-column') as KanbanColumn;
        }
      }

      if (targetColumn && targetColumn !== dragData.fromColumn) {
        const colLeads = leadsInColumn(targetColumn);
        const newSortOrder = colLeads.length > 0
          ? Math.max(...colLeads.map((l) => l.sortOrder ?? 0)) + 10
          : 0;

        onMove(dragData.leadId, targetColumn, newSortOrder);
      }

      // Cleanup
      delete (window as any).__cogmapDragData;
      setDragOverCol(null);
    }

    window.addEventListener('pointermove', handleGlobalPointerMove);
    window.addEventListener('pointerup', handleGlobalPointerUp);

    return () => {
      window.removeEventListener('pointermove', handleGlobalPointerMove);
      window.removeEventListener('pointerup', handleGlobalPointerUp);
    };
  }, [leadsInColumn, onMove]);

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
        gap: '0.75rem',
        overflowX: 'auto',
        overflowY: 'visible',
        minHeight: '100%',
        padding: '0.5rem',
        paddingBottom: '2rem',
        touchAction: 'pan-y',
        WebkitOverflowScrolling: 'touch',
        scrollSnapType: 'x proximity',
        msOverflowStyle: 'auto',
        scrollbarWidth: 'auto',
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
            ref={(el) => { colRefs.current[col.key] = el; }}
            style={{
              flex: '0 0 280px',
              minWidth: 240,
              maxHeight: 'calc(100vh - 220px)',
              display: 'flex',
              flexDirection: 'column',
              scrollSnapAlign: 'start',
            }}
          >
            {/* Column Header */}
            <Group justify="space-between" align="center" mb="xs">
              <Text fw={600} size="sm" tt="uppercase">
                {col.label}
              </Text>
              <Badge variant="light" color={color} size="sm">
                {colLeads.length}
              </Badge>
            </Group>

            {/* Column Body — scrollable vertically */}
            <Card
              padding="xs"
              radius="md"
              withBorder
              style={{
                flex: 1,
                overflowY: 'auto',
                maxHeight: 'calc(100vh - 280px)',
                backgroundColor: isDropTarget ? `var(--mantine-color-${color}-1)` : `var(--mantine-color-${color}-0)`,
                border: isDropTarget ? `2px dashed var(--mantine-color-${color}-5)` : undefined,
                transition: 'all 0.2s ease',
                WebkitOverflowScrolling: 'touch',
                touchAction: 'pan-y',
              }}
            >
              <Stack gap="xs">
                {colLeads.map((lead) => (
                  <LeadCard
                    key={lead._id}
                    lead={lead}
                    onClick={() => setSelectedLead(lead)}
                    onDragStart={() => {}}
                    onDragEnd={() => {}}
                  />
                ))}
                {colLeads.length === 0 && (
                  <Text size="xs" c="dimmed" ta="center" py="xl">
                    {col.description}
                  </Text>
                )}
              </Stack>
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
