'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Box, Text, Badge, Button, Group, Stack, TextInput, ActionIcon } from '@mantine/core';
import { IconChevronLeft, IconChevronRight, IconAdjustmentsHorizontal, IconX, IconCheck, IconGripVertical } from '@tabler/icons-react';
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
  const [showFilters, setShowFilters] = useState(false);
  const [regionFilter, setRegionFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const boardRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    leadId: string;
    startX: number;
    startY: number;
    ghost: HTMLDivElement | null;
    sourceColumn: KanbanColumn;
  } | null>(null);

  function leadsInColumn(col: KanbanColumn): Lead[] {
    let colLeads = leads
      .filter((l) => l.kanbanColumn === col)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

    if (regionFilter !== 'ALL') {
      colLeads = colLeads.filter((l) => l.region === regionFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      colLeads = colLeads.filter((l) =>
        l.entity_name.toLowerCase().includes(q) ||
        l.decision_maker_name?.toLowerCase().includes(q) ||
        l.sport_or_sector?.toLowerCase().includes(q)
      );
    }
    return colLeads;
  }

  const totalFiltered = leads.filter((l) => {
    if (regionFilter !== 'ALL' && l.region !== regionFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return l.entity_name.toLowerCase().includes(q) ||
        l.decision_maker_name?.toLowerCase().includes(q) ||
        l.sport_or_sector?.toLowerCase().includes(q);
    }
    return true;
  }).length;

  // Drag handling
  const handleDragStart = (e: React.PointerEvent, leadId: string, column: KanbanColumn) => {
    const target = e.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();

    dragRef.current = {
      leadId,
      startX: e.clientX,
      startY: e.clientY,
      ghost: null,
      sourceColumn: column,
    };

    target.setPointerCapture(e.pointerId);
    target.style.opacity = '0.4';
  };

  const handleDragMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;

    const deltaX = e.clientX - dragRef.current.startX;
    const deltaY = e.clientY - dragRef.current.startY;

    // Create ghost on first significant move
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

    // Check if dropped on a different column
    const dropTarget = document.elementFromPoint(e.clientX, e.clientY);
    const dropColumn = dropTarget?.closest('[data-column]');
    const targetColumn = dropColumn?.getAttribute('data-column') as KanbanColumn | undefined;

    if (targetColumn && targetColumn !== dragRef.current.sourceColumn) {
      const colLeads = leadsInColumn(targetColumn);
      const sortOrder = colLeads.length > 0 ? Math.max(...colLeads.map(l => l.sortOrder ?? 0)) + 1 : 0;
      await onMove(dragRef.current.leadId, targetColumn, sortOrder);
    }

    dragRef.current = null;
    setIsDragging(false);
  };

  // Scroll to column
  const scrollToColumn = (colKey: KanbanColumn) => {
    if (!boardRef.current) return;
    const columnEl = boardRef.current.querySelector(`[data-column="${colKey}"]`) as HTMLElement;
    if (columnEl) {
      columnEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  };

  // Keyboard navigation
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
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100dvh',
        overflow: 'hidden',
      }}
    >
      {/* Compact header */}
      <Box
        style={{
          padding: '0.5rem 0.75rem',
          borderBottom: '1px solid var(--mantine-color-gray-2)',
          backgroundColor: 'var(--mantine-color-gray-0)',
          flexShrink: 0,
        }}
      >
        <Group justify="space-between" align="center">
          <Group gap="xs">
            <Text fw={700} size="sm">{totalFiltered} leads</Text>
            {isDragging && (
              <Text size="xs" c="blue" fw={500}>
                Drop on a column to move
              </Text>
            )}
          </Group>
          <ActionIcon
            size="sm"
            variant={showFilters ? 'filled' : 'light'}
            color="gray"
            onClick={() => setShowFilters(!showFilters)}
          >
            <IconAdjustmentsHorizontal size={16} />
          </ActionIcon>
        </Group>

        {/* Collapsible filters */}
        {showFilters && (
          <Box mt="xs">
            <Group gap="xs" wrap="wrap">
              {['ALL', 'US', 'CEE', 'MENA'].map((r) => (
                <Button
                  key={r}
                  size="xs"
                  variant={regionFilter === r ? 'filled' : 'light'}
                  onClick={() => setRegionFilter(r)}
                >
                  {r === 'ALL' ? 'All' : r}
                </Button>
              ))}
              <input
                type="text"
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  flex: 1,
                  minWidth: 100,
                  padding: '0.3rem 0.5rem',
                  borderRadius: '0.25rem',
                  border: '1px solid var(--mantine-color-gray-3)',
                  fontSize: '0.8rem',
                }}
              />
            </Group>
          </Box>
        )}
      </Box>

      {/* Board — horizontal scroll */}
      <Box
        ref={boardRef}
        style={{
          flex: 1,
          display: 'flex',
          overflowX: 'auto',
          overflowY: 'hidden',
          gap: '0.75rem',
          padding: '0.75rem',
          scrollSnapType: 'x proximity',
          WebkitOverflowScrolling: 'touch',
          scrollBehavior: 'smooth',
        }}
      >
        {COLUMNS.map((col) => {
          const colLeads = leadsInColumn(col.key);
          const color = semanticToneToMantineColor(col.color);

          return (
            <Box
              key={col.key}
              data-column={col.key}
              style={{
                minWidth: 300,
                maxWidth: 340,
                flexShrink: 0,
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                backgroundColor: 'var(--mantine-color-gray-0)',
                borderRadius: '0.5rem',
                border: '1px solid var(--mantine-color-gray-3)',
                scrollSnapAlign: 'start',
              }}
            >
              {/* Column header */}
              <Box
                style={{
                  padding: '0.6rem 0.75rem',
                  backgroundColor: `var(--mantine-color-${color}-0)`,
                  borderBottom: `2px solid var(--mantine-color-${color}-3)`,
                  borderRadius: '0.5rem 0.5rem 0 0',
                  flexShrink: 0,
                }}
              >
                <Group justify="space-between" align="center">
                  <Group gap="xs">
                    <Text fw={700} size="sm" tt="uppercase">{col.label}</Text>
                  </Group>
                  <Badge variant="light" color={color} size="sm">{colLeads.length}</Badge>
                </Group>
              </Box>

              {/* Cards — scrollable */}
              <Box
                style={{
                  flex: 1,
                  overflowY: 'auto',
                  overflowX: 'hidden',
                  padding: '0.5rem',
                  WebkitOverflowScrolling: 'touch',
                }}
              >
                {colLeads.length === 0 ? (
                  <Text size="xs" c="dimmed" ta="center" py="xl">
                    {col.description}
                  </Text>
                ) : (
                  <Stack gap="xs">
                    {colLeads.map((lead) => (
                      <Box
                        key={lead._id}
                        onPointerDown={(e) => handleDragStart(e, lead._id, col.key)}
                        onPointerMove={handleDragMove}
                        onPointerUp={(e) => handleDragEnd(e, col.key)}
                        onPointerCancel={() => {
                          if (dragRef.current?.ghost) dragRef.current.ghost.remove();
                          dragRef.current = null;
                          setIsDragging(false);
                        }}
                        style={{ touchAction: 'none' }}
                      >
                        <Box
                          onClick={() => !isDragging && setSelectedLead(lead)}
                          style={{
                            cursor: isDragging ? 'grabbing' : 'pointer',
                            opacity: dragRef.current?.leadId === lead._id ? 0.4 : 1,
                          }}
                        >
                          <LeadCard lead={lead} />
                        </Box>
                      </Box>
                    ))}
                  </Stack>
                )}
              </Box>
            </Box>
          );
        })}
      </Box>

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
