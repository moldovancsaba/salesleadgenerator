'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Box, Text, Badge, Button, Group, Stack, ActionIcon } from '@mantine/core';
import { IconChevronLeft, IconChevronRight, IconAdjustmentsHorizontal } from '@tabler/icons-react';
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
  const [currentColIndex, setCurrentColIndex] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const boardRef = useRef<HTMLDivElement>(null);

  // Only use columns that have leads or are agent-managed
  const activeColumns = COLUMNS.filter(col => {
    const colLeads = leads.filter(l => l.kanbanColumn === col.key);
    return colLeads.length > 0 || ['DISCOVERED', 'QUALIFIED'].includes(col.key);
  });

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

  const currentCol = activeColumns[currentColIndex] || activeColumns[0];
  const currentLeads = leadsInColumn(currentCol?.key || 'DISCOVERED');
  const currentColor = currentCol ? semanticToneToMantineColor(currentCol.color) : 'gray';

  // Navigation
  const goToPrev = useCallback(() => {
    if (currentColIndex > 0) {
      setIsTransitioning(true);
      setCurrentColIndex(i => i - 1);
      setTimeout(() => setIsTransitioning(false), 300);
    }
  }, [currentColIndex]);

  const goToNext = useCallback(() => {
    if (currentColIndex < activeColumns.length - 1) {
      setIsTransitioning(true);
      setCurrentColIndex(i => i + 1);
      setTimeout(() => setIsTransitioning(false), 300);
    }
  }, [currentColIndex, activeColumns.length]);

  // Touch swipe handling
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    const deltaX = e.changedTouches[0].clientX - touchStartX.current;
    const deltaY = e.changedTouches[0].clientY - touchStartY.current;

    // Only trigger if horizontal swipe is dominant
    if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 50) {
      if (deltaX < 0) {
        goToNext(); // Swipe left → next column
      } else {
        goToPrev(); // Swipe right → previous column
      }
    }
  };

  // Keyboard navigation
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'ArrowLeft') goToPrev();
      if (e.key === 'ArrowRight') goToNext();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [goToPrev, goToNext]);

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
    <Box
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100dvh',
        overflow: 'hidden',
        touchAction: 'pan-y',
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
            <Badge size="xs" variant="light" color={currentColor}>{currentCol?.label}</Text>
            <Text size="xs" c="dimmed">
              {currentColIndex + 1}/{activeColumns.length}
            </Text>
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

        {/* Column navigation */}
        <Group justify="center" gap="xs" mt="xs">
          <ActionIcon
            size="xs"
            variant="subtle"
            disabled={currentColIndex === 0}
            onClick={goToPrev}
          >
            <IconChevronLeft size={16} />
          </ActionIcon>

          {/* Dot indicators */}
          <Group gap={4}>
            {activeColumns.map((col, i) => (
              <Box
                key={col.key}
                onClick={() => {
                  setIsTransitioning(true);
                  setCurrentColIndex(i);
                  setTimeout(() => setIsTransitioning(false), 300);
                }}
                style={{
                  width: currentColIndex === i ? 20 : 8,
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: currentColIndex === i
                    ? `var(--mantine-color-${semanticToneToMantineColor(col.color)}-6)`
                    : 'var(--mantine-color-gray-3)',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
              />
            ))}
          </Group>

          <ActionIcon
            size="xs"
            variant="subtle"
            disabled={currentColIndex === activeColumns.length - 1}
            onClick={goToNext}
          >
            <IconChevronRight size={16} />
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

      {/* Column content — swipeable */}
      <Box
        ref={boardRef}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        style={{
          flex: 1,
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        <Box
          style={{
            display: 'flex',
            height: '100%',
            transform: `translateX(-${currentColIndex * 100}%)`,
            transition: isTransitioning ? 'transform 0.3s ease' : 'none',
          }}
        >
          {activeColumns.map((col) => {
            const colLeads = leadsInColumn(col.key);
            const color = semanticToneToMantineColor(col.color);

            return (
              <Box
                key={col.key}
                style={{
                  minWidth: '100%',
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  padding: '0.5rem',
                  overflow: 'hidden',
                }}
              >
                {/* Column title */}
                <Box
                  style={{
                    padding: '0.5rem',
                    backgroundColor: `var(--mantine-color-${color}-0)`,
                    borderBottom: `2px solid var(--mantine-color-${color}-3)`,
                    borderRadius: '0.4rem',
                    marginBottom: '0.5rem',
                    flexShrink: 0,
                  }}
                >
                  <Group justify="space-between" align="center">
                    <Text fw={700} size="sm" tt="uppercase">{col.label}</Text>
                    <Badge variant="light" color={color} size="sm">{colLeads.length}</Badge>
                  </Group>
                </Box>

                {/* Cards — scrollable */}
                <Box
                  style={{
                    flex: 1,
                    overflowY: 'auto',
                    overflowX: 'hidden',
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
                      {colLeads.map((lead) => (
                        <Box
                          key={lead._id}
                          onClick={() => setSelectedLead(lead)}
                        >
                          <LeadCard lead={lead} />
                        </Box>
                      ))}
                    </Stack>
                  )}
                </Box>
              </Box>
            );
          })}
        </Box>
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
