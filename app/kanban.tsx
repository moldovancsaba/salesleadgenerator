'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { Box, Group, Text, Badge, Card, Button } from '@mantine/core';
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
  const longPressTimer = useRef<number | null>(null);
  const [isLongPress, setIsLongPress] = useState(false);

  function leadsInColumn(col: KanbanColumn): Lead[] {
    return leads
      .filter((l) => l.kanbanColumn === col)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  }

  // Cleanup
  useEffect(() => {
    return () => {
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
    };
  }, []);

  // Global pointer move/up for drag
  useEffect(() => {
    function onPointerMove(e: PointerEvent) {
      if (!dragInfo.current || !draggingId) return;
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el) { setDragOverCol(null); return; }
      const colEl = el.closest('[data-column]');
      const col = colEl?.getAttribute('data-column') as KanbanColumn | null;
      if (col && col !== dragInfo.current.fromColumn) {
        setDragOverCol(col);
      } else {
        setDragOverCol(null);
      }
    }

    function onPointerUp(e: PointerEvent) {
      if (!dragInfo.current || !draggingId) return;
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
      setIsLongPress(false);
    }

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [draggingId, dragOverCol, leadsInColumn, onMove]);

  function handleCardPointerDown(e: React.PointerEvent, lead: Lead) {
    if (e.button !== 0) return;
    setIsLongPress(false);

    longPressTimer.current = window.setTimeout(() => {
      setIsLongPress(true);
      dragInfo.current = { leadId: lead._id, fromColumn: lead.kanbanColumn };
      setDraggingId(lead._id);
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      document.body.style.userSelect = 'none';
      document.body.style.touchAction = 'none';
    }, 400);
  }

  function handleCardPointerMove(e: React.PointerEvent) {
    if (longPressTimer.current && !draggingId) {
      const dx = e.movementX;
      const dy = e.movementY;
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
        clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
      }
    }
  }

  function handleCardPointerUp(e: React.PointerEvent) {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    if (!draggingId) {
      document.body.style.userSelect = '';
      document.body.style.touchAction = '';
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

  // Drag ghost element
  const dragLead = draggingId ? leads.find(l => l._id === draggingId) : null;

  return (
    <>
      <Box
        style={{
          display: 'flex',
          gap: '0.75rem',
          overflowX: 'auto',
          overflowY: 'hidden',
          height: 'calc(100vh - 180px)',
          minHeight: 500,
          padding: '0.5rem',
          paddingBottom: '1rem',
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
                display: 'flex',
                flexDirection: 'column',
                height: '100%',
              }}
            >
              {/* Header */}
              <Box
                style={{
                  padding: '0.5rem 0.75rem',
                  borderRadius: '0.5rem 0.5rem 0 0',
                  backgroundColor: `var(--mantine-color-${color}-0)`,
                  borderBottom: `2px solid var(--mantine-color-${color}-3)`,
                  marginBottom: '0.25rem',
                }}
              >
                <Group justify="space-between" align="center">
                  <Text fw={700} size="sm" tt="uppercase">{col.label}</Text>
                  <Badge variant="light" color={color} size="sm">{colLeads.length}</Badge>
                </Group>
              </Box>

              {/* Cards — scrollable */}
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
                    : `var(--mantine-color-gray-0)`,
                  border: isDropTarget
                    ? `2px dashed var(--mantine-color-${color}-5)`
                    : undefined,
                  transition: 'background-color 0.15s, border-color 0.15s',
                  WebkitOverflowScrolling: 'touch',
                  touchAction: 'pan-y',
                }}
              >
                {colLeads.length === 0 ? (
                  <Text size="xs" c="dimmed" ta="center" py="xl">
                    {col.description}
                  </Text>
                ) : (
                  <Stack gap="xs">
                    {colLeads.map((lead) => {
                      const isDragging = draggingId === lead._id;
                      return (
                        <Box
                          key={lead._id}
                          onPointerDown={(e) => handleCardPointerDown(e, lead)}
                          onPointerMove={handleCardPointerMove}
                          onPointerUp={handleCardPointerUp}
                          onClick={() => {
                            if (!isLongPress && !draggingId) {
                              setSelectedLead(lead);
                            }
                          }}
                          style={{
                            opacity: isDragging ? 0.3 : 1,
                            transform: isDragging ? 'scale(0.95)' : 'scale(1)',
                            transition: 'opacity 0.15s, transform 0.15s',
                            cursor: isLongPress ? 'grabbing' : 'grab',
                          }}
                        >
                          <LeadCard
                            lead={lead}
                            isDragging={isDragging}
                          />
                        </Box>
                      );
                    })}
                  </Stack>
                )}
              </Card>
            </Box>
          );
        })}
      </Box>

      {/* Drag ghost */}
      {dragLead && (
        <Box
          style={{
            position: 'fixed',
            pointerEvents: 'none',
            zIndex: 9999,
            opacity: 0.9,
            transform: 'rotate(2deg)',
          }}
          id="drag-ghost"
        >
          <LeadCard lead={dragLead} isDragging={true} />
        </Box>
      )}

      {selectedLead && (
        <LeadDetailModal
          lead={selectedLead}
          onClose={() => setSelectedLead(null)}
          onAction={handleAction}
          onUpdated={() => setSelectedLead(null)}
        />
      )}
    </>
  );
}
