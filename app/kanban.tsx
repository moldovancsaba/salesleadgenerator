'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import { Box, Text, Group, ActionIcon, Button } from '@mantine/core';
import { IconChevronDown, IconChevronRight, IconArrowsSort } from '@tabler/icons-react';
import type { Lead, KanbanColumn } from './types';
import { LeadCard } from './card';
import { semanticToneToMantineColor } from './utils/semantic-colors';
import { COLUMNS, getIceScore } from './constants';
import { breakpoints } from './theme/breakpoints';

type BoardProps = {
  leads: Lead[];
  onMove: (leadId: string, column: KanbanColumn, sortOrder: number) => Promise<void>;
  onOpenLead: (lead: Lead) => void;
  collapsedColumns?: Record<string, boolean>;
  onToggleColumn?: (key: string) => void;
  columnCounts?: Record<string, number>;
  sortKey?: 'ice' | 'name';
  sortOrder?: 'asc' | 'desc';
  onSortKeyChange?: (key: 'ice' | 'name') => void;
  onSortOrderChange?: (order: 'asc' | 'desc') => void;
  mode?: string;
};

type LayoutMode = 'mobile-portrait' | 'mobile-landscape' | 'tablet-portrait' | 'tablet-landscape' | 'desktop';

const DESKTOP_MIN = breakpoints.desktopMin;

function useBreakpoint() {
  const [mode, setMode] = useState<LayoutMode>('desktop');

  useEffect(() => {
    if (typeof window === 'undefined') return;

    function computeMode(): LayoutMode {
      const width = window.innerWidth;
      if (width >= breakpoints.desktopMin) return 'desktop';
      if (width >= breakpoints.tabletLandscapeMin) return 'tablet-landscape';
      if (width >= breakpoints.tabletPortraitMin) return 'tablet-portrait';
      if (width >= breakpoints.mobileLandscapeMin) return 'mobile-landscape';
      return 'mobile-portrait';
    }

    setMode(computeMode());

    const mql = window.matchMedia(`(max-width: ${DESKTOP_MIN}px)`);
    const handler = () => setMode(computeMode());
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', handler);
    } else {
      (mql as any).addListener(handler);
    }
    return () => {
      if (typeof mql.removeEventListener === 'function') {
        mql.removeEventListener('change', handler);
      } else {
        (mql as any).removeListener(handler);
      }
    };
  }, []);

  return mode;
}

export function KanbanBoard({ leads, onMove, onOpenLead, collapsedColumns = {}, onToggleColumn, columnCounts = {}, sortKey = 'ice', sortOrder = 'desc', onSortKeyChange, onSortOrderChange, mode: modeProp }: BoardProps) {
  const [isDragging, setIsDragging] = useState(false);
  const mode = modeProp || useBreakpoint();
  const boardRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    leadId: string;
    startX: number;
    startY: number;
    ghost: HTMLDivElement | null;
    sourceColumn: KanbanColumn;
    sourceEl: HTMLElement | null;
  } | null>(null);

  const isMobile = mode === 'mobile-portrait' || mode === 'mobile-landscape';
  const isTablet = mode === 'tablet-portrait' || mode === 'tablet-landscape';
  const showAdvancedControls = !isMobile;
  const enableDrag = !isMobile;

  const visibleColumns = useMemo(() => COLUMNS, []);
  const sortControls = showAdvancedControls && onSortKeyChange && onSortOrderChange ? (
    <Group gap="xs" mb="xs">
      <Button
        size="xs"
        variant={sortKey === 'ice' ? 'filled' : 'light'}
        color="gray"
        onClick={() => onSortKeyChange('ice')}
        rightSection={<IconArrowsSort size={14} />}
      >
        ICE {sortKey === 'ice' ? (sortOrder === 'asc' ? '↑' : '↓') : ''}
      </Button>
      <Button
        size="xs"
        variant={sortKey === 'name' ? 'filled' : 'light'}
        color="gray"
        onClick={() => onSortKeyChange('name')}
        rightSection={<IconArrowsSort size={14} />}
      >
        Name {sortKey === 'name' ? (sortOrder === 'asc' ? '↑' : '↓') : ''}
      </Button>
      <Button
        size="xs"
        variant="light"
        color="gray"
        onClick={() => onSortOrderChange(sortOrder === 'asc' ? 'desc' : 'asc')}
      >
        {sortOrder === 'asc' ? 'Asc ↑' : 'Desc ↓'}
      </Button>
    </Group>
  ) : null;

  const boardContent = visibleColumns.map((col) => {
    const colLeads = leads.filter((l) => l.kanbanColumn === col.key);
    const sorted = [...colLeads];
    sorted.sort((a, b) => {
      if (sortKey === 'name') {
        const an = (a.entity_name || '').toLowerCase();
        const bn = (b.entity_name || '').toLowerCase();
        return sortOrder === 'asc' ? an.localeCompare(bn) : bn.localeCompare(an);
      }
      const ia = getIceScore(a);
      const ib = getIceScore(b);
      return sortOrder === 'asc' ? ia - ib : ib - ia;
    });
    const color = semanticToneToMantineColor(col.color);
    const collapsed = Boolean(collapsedColumns[col.key]);
    const toggleColumn = () => onToggleColumn?.(col.key);
    const headerTone = col.key === 'WON' ? 'green' : col.key === 'LOST' ? 'red' : col.color;

    return (
      <Box
        key={col.key}
        data-column={col.key}
        className={`kanban-column kanban-column--${mode}`}
        style={{
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: 'var(--mantine-color-gray-0)',
          borderRadius: '0.5rem',
          border: '1px solid var(--mantine-color-gray-3)',
        }}
      >
        <Group justify="space-between" align="center" p="xs" style={{ borderBottom: '1px solid var(--mantine-color-gray-2)' }}>
          <Group gap="xs">
            {toggleColumn && (
              <ActionIcon variant="subtle" size="xs" onClick={toggleColumn}>
                {collapsed ? <IconChevronRight size={14} /> : <IconChevronDown size={14} />}
              </ActionIcon>
            )}
            <Text size="sm" fw={600}>{col.label}</Text>
            <Text size="xs" c="dimmed">({columnCounts[col.key] ?? sorted.length})</Text>
          </Group>
        </Group>

        {!collapsed && (
          <Box style={{
            flex: 1,
            overflowY: 'auto',
            padding: '0.5rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5rem',
            minHeight: 0,
          }}>
            {sorted.map((lead) => (
              <LeadCard
                key={lead._id}
                lead={lead}
                onOpen={() => onOpenLead(lead)}
              />
            ))}
            {!sorted.length && (
              <Text size="xs" c="dimmed" ta="center" py="md">
                No leads
              </Text>
            )}
          </Box>
        )}
      </Box>
    );
  });

  return (
    <Box>
      {showAdvancedControls && sortControls}
      <Box
        ref={boardRef}
        className={`kanban-board kanban-board--${mode}`}
        style={{
          flex: '1 1 auto',
          height: 'auto',
          minHeight: 0,
          display: 'flex',
          gap: '0.75rem',
          overflowX: 'auto',
          padding: '0.5rem',
        }}
      >
        {boardContent}
      </Box>
    </Box>
  );
}
