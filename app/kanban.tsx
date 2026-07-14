'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { Box, Group, Text, Badge, Card, Button, ActionIcon } from '@mantine/core';
import { IconAdjustmentsHorizontal, IconX } from '@tabler/icons-react';
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
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);

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

  // Process pending drops from card pointer events
  useEffect(() => {
    const drop = (window as any).__pendingDrop;
    if (!drop) return;

    const colLeads = leads.filter((l) => l.kanbanColumn === drop.toColumn);
    const newSort = colLeads.length > 0
      ? Math.max(...colLeads.map((l) => l.sortOrder ?? 0)) + 10
      : 0;
    onMove(drop.leadId, drop.toColumn, newSort);
    delete (window as any).__pendingDrop;
  }, [leads, onMove]);

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

  return (
    <Box style={{ display: 'flex', flexDirection: 'column', height: '100dvh' }}>
      {/* Toolbar — compact */}
      <Box
        style={{
          padding: '0.5rem 0.75rem',
          borderBottom: '1px solid var(--mantine-color-gray-2)',
          backgroundColor: 'var(--mantine-color-gray-0)',
          flexShrink: 0,
        }}
      >
        <Group justify="space-between" align="center" gap="xs">
          <Group gap="xs">
            <Text fw={700} size="sm">{totalFiltered} leads</Text>
            {(regionFilter !== 'ALL' || searchQuery.trim()) && (
              <Badge size="xs" variant="light" color="blue">filtered</Badge>
            )}
          </Group>
          <ActionIcon
            size="sm"
            variant={showFilters ? 'filled' : 'light'}
            color="gray"
            onClick={() => setShowFilters(!showFilters)}
            aria-label="Filters"
          >
            <IconAdjustmentsHorizontal size={16} />
          </ActionIcon>
        </Group>

        {/* Collapsible filters */}
        {showFilters && (
          <Box mt="xs" pb="xs">
            <Group gap="xs" wrap="wrap">
              {['ALL', 'US', 'CEE', 'MENA'].map((r) => (
                <Button
                  key={r}
                  size="xs"
                  variant={regionFilter === r ? 'filled' : 'light'}
                  color="gray"
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
                  minWidth: 120,
                  padding: '0.3rem 0.5rem',
                  borderRadius: '0.25rem',
                  border: '1px solid var(--mantine-color-gray-3)',
                  fontSize: '0.8rem',
                  backgroundColor: 'var(--mantine-color-white)',
                  color: 'var(--mantine-color-gray-9)',
                }}
              />
            </Group>
          </Box>
        )}
      </Box>

      {/* Board — horizontal scroll, each column scrolls vertically */}
      <Box
        ref={boardRef}
        style={{
          display: 'flex',
          gap: '0.5rem',
          overflowX: 'auto',
          overflowY: 'hidden',
          flex: 1,
          padding: '0.5rem',
          paddingBottom: '1.5rem',
          scrollSnapType: 'x proximity',
          WebkitOverflowScrolling: 'touch',
          scrollbarWidth: 'thin',
        }}
      >
        {COLUMNS.map((col) => {
          const colLeads = leadsInColumn(col.key);
          const color = semanticToneToMantineColor(col.color);
          const isOver = draggingId !== null;

          return (
            <Box
              key={col.key}
              data-column={col.key}
              style={{
                flex: '0 0 290px',
                minWidth: 260,
                maxWidth: 320,
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                scrollSnapAlign: 'start',
              }}
            >
              {/* Column header */}
              <Box
                style={{
                  padding: '0.45rem 0.65rem',
                  backgroundColor: `var(--mantine-color-${color}-0)`,
                  borderBottom: `2px solid var(--mantine-color-${color}-3)`,
                  borderRadius: '0.4rem 0.4rem 0 0',
                  marginBottom: '0.2rem',
                  flexShrink: 0,
                }}
              >
                <Group justify="space-between" align="center" gap="xs">
                  <Text fw={700} size="xs" tt="uppercase" c={color}>{col.label}</Text>
                  <Badge variant="light" color={color} size="xs">{colLeads.length}</Badge>
                </Group>
              </Box>

              {/* Cards — vertically scrollable */}
              <Card
                padding="xs"
                radius="md"
                withBorder
                style={{
                  flex: 1,
                  overflowY: 'auto',
                  overflowX: 'hidden',
                  backgroundColor: 'var(--mantine-color-gray-0)',
                  transition: 'background-color 0.15s',
                  WebkitOverflowScrolling: 'touch',
                  touchAction: 'pan-y',
                  border: isOver ? '2px dashed var(--mantine-color-gray-4)' : undefined,
                }}
              >
                {colLeads.length === 0 ? (
                  <Text size="xs" c="dimmed" ta="center" py="xl">
                    {col.description}
                  </Text>
                ) : (
                  <Box style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                    {colLeads.map((lead) => (
                      <LeadCard
                        key={lead._id}
                        lead={lead}
                        isDragging={draggingId === lead._id}
                        onClick={() => setSelectedLead(lead)}
                        onDragStart={() => setDraggingId(lead._id)}
                        onDragEnd={() => setDraggingId(null)}
                      />
                    ))}
                  </Box>
                )}
              </Card>
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
