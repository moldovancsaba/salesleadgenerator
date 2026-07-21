'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import { Box, Text, Group, ActionIcon, Button, Select } from '@mantine/core';
import { IconChevronDown, IconChevronRight, IconArrowsSort } from '@tabler/icons-react';
import type { Lead, KanbanColumn } from './types';
import { LeadCard } from './card';
import { semanticToneToMantineColor } from './utils/semantic-colors';
import { COLUMNS, getIceScore } from './constants';
import { tokens } from './theme/tokens';
import { breakpoints } from './theme/breakpoints';
import { ColumnHeader } from './components/ui/column-header';
import { BoardLayout } from './components/ui/board-layout';

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
  mode?: LayoutMode;
};

type LayoutMode = 'mobile-portrait' | 'mobile-landscape' | 'tablet-portrait' | 'tablet-landscape' | 'desktop';

const MOBILE_MAX = breakpoints.mobileMax;
const MOBILE_LANDSCAPE_MIN = breakpoints.mobileLandscapeMin;
const MOBILE_LANDSCAPE_MAX = breakpoints.mobileLandscapeMax;
const TABLET_PORTRAIT_MIN = breakpoints.tabletPortraitMin;
const TABLET_PORTRAIT_MAX = breakpoints.tabletPortraitMax;
const TABLET_LANDSCAPE_MIN = breakpoints.tabletLandscapeMin;
const TABLET_LANDSCAPE_MAX = breakpoints.tabletLandscapeMax;
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

  const mobileColumnOptions = useMemo(() => COLUMNS.map((col) => ({ value: col.key, label: `${col.icon} ${col.label}` })), []);
  const mobileSelectedColumn = useMemo(() => {
    if (mode !== 'mobile-portrait') return null;
    const discovered = leads.find((l) => l.kanbanColumn === 'DISCOVERED');
    return discovered?.kanbanColumn || 'DISCOVERED';
  }, [leads, mode]);

  const visibleColumns = useMemo(() => {
    if (mode === 'mobile-portrait') {
      const active = mobileSelectedColumn || 'DISCOVERED';
      return COLUMNS.filter((col) => col.key === active);
    }
    return COLUMNS;
  }, [mode, mobileSelectedColumn]);

  function leadsInColumn(col: KanbanColumn): Lead[] {
    const list = leads.filter((l) => l.kanbanColumn === col);
    const sorted = [...list];
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
    return sorted;
  }

  const handleDragStart = (e: React.PointerEvent, leadId: string, column: KanbanColumn) => {
    if (!enableDrag) return;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    target.style.opacity = '0.4';

    dragRef.current = {
      leadId,
      startX: e.clientX,
      startY: e.clientY,
      ghost: null,
      sourceColumn: column,
      sourceEl: target,
    };

    setIsDragging(true);
  };

  const handleDragMove = (e: React.PointerEvent) => {
    if (!enableDrag || !dragRef.current) return;

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

  const cleanupDrag = () => {
    if (dragRef.current?.sourceEl) {
      dragRef.current.sourceEl.style.opacity = '1';
    }
    if (dragRef.current?.ghost) {
      dragRef.current.ghost.remove();
    }
    dragRef.current = null;
    setIsDragging(false);
  };

  const handleDragEnd = async (e: React.PointerEvent, column: KanbanColumn) => {
    if (!enableDrag) return;
    const target = e.currentTarget as HTMLElement;
    target.style.opacity = '1';

    if (dragRef.current?.ghost) {
      dragRef.current.ghost.remove();
    }

    if (!dragRef.current) {
      cleanupDrag();
      return;
    }

    const dropTarget = document.elementFromPoint(e.clientX, e.clientY);
    const dropColumn = dropTarget?.closest('[data-column]');
    const targetColumn = dropColumn?.getAttribute('data-column') as KanbanColumn | undefined;

    if (targetColumn && targetColumn !== dragRef.current.sourceColumn) {
      const colLeads = leadsInColumn(targetColumn);
      const sortOrder = colLeads.length > 0 ? Math.max(...colLeads.map((l) => l.sortOrder ?? 0)) + 1 : 0;
      await onMove(dragRef.current.leadId, targetColumn, sortOrder);
    }

    cleanupDrag();
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

  const boardClass = `kanban-board kanban-board--${mode}`;
  const columnClass = (colKey: KanbanColumn) =>
    `kanban-column kanban-column--${mode}` + (collapsedColumns[colKey] ? ' kanban-column--collapsed' : '');

  const columnBaseStyle: React.CSSProperties = {
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: 'var(--mantine-color-gray-0)',
    borderRadius: tokens.radii.md,
    border: '1px solid var(--mantine-color-gray-3)',
  };

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
    const colLeads = leadsInColumn(col.key);
    const color = semanticToneToMantineColor(col.color);
    const collapsed = Boolean(collapsedColumns[col.key]);
    const toggleColumn = () => onToggleColumn?.(col.key);
    const headerTone = col.key === 'WON' ? 'green' : col.key === 'LOST' ? 'red' : col.color;

    return (
      <Box
        key={col.key}
        data-column={col.key}
        className={columnClass(col.key)}
        style={columnBaseStyle}
      >
        <ColumnHeader
          label={col.label}
          count={columnCounts[col.key] ?? colLeads.length}
          tone={headerTone}
          collapsed={collapsed}
          onToggle={toggleColumn}
        />

        {!collapsed && (
          <Box style={{
            flex: 1,
            overflowY: 'auto',
            padding: tokens.spacing.xs,
            display: 'flex',
            flexDirection: 'column',
            gap: tokens.spacing.xs,
            minHeight: 0,
          }}>
            {colLeads.map((lead) => (
              <LeadCard
                key={lead._id}
                lead={lead}
                onOpen={() => onOpenLead(lead)}
                onMoveStart={(e) => handleDragStart(e, lead._id, col.key)}
                onMove={handleDragMove}
                onMoveEnd={(e) => handleDragEnd(e, col.key)}
                isDragging={isDragging}
                mode={mode}
              />
            ))}
            {!colLeads.length && (
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
    <BoardLayout
      mode={mode}
      showAdvancedControls={showAdvancedControls}
      sortControls={sortControls}
      boardContent={boardContent}
      boardClassName={boardClass}
      boardStyle={{
        flex: '1 1 auto',
        height: 'auto',
        minHeight: 0,
      }}
      boardRef={boardRef}
    />
  );
}
