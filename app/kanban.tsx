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
};

type LayoutMode = 'mobile-portrait' | 'mobile-landscape' | 'tablet-portrait' | 'tablet-landscape' | 'desktop';

const MOBILE_MAX = breakpoints.mobileMax;
const MOBILE_LANDSCAPE_MAX = breakpoints.mobileLandscapeMax;
const TABLET_PORTRAIT_MAX = breakpoints.tabletPortraitMax;
const TABLET_LANDSCAPE_MAX = breakpoints.tabletLandscapeMax;
const DESKTOP_MIN = breakpoints.desktopMin;

function useBreakpoint() {
  const [mode, setMode] = useState<LayoutMode>('desktop');

  useEffect(() => {
    if (typeof window === 'undefined') return;

    function computeMode(): LayoutMode {
      const width = window.innerWidth;
      if (width >= DESKTOP_MIN) return 'desktop';
      if (width > TABLET_LANDSCAPE_MAX) return 'desktop';
      if (width > TABLET_PORTRAIT_MAX) return 'tablet-landscape';
      if (width > MOBILE_LANDSCAPE_MAX) return 'tablet-portrait';
      if (width > MOBILE_MAX) return 'mobile-landscape';
      return 'mobile-portrait';
    }

    setMode(computeMode());

    const mql = window.matchMedia(`(max-width: ${MOBILE_MAX}px)`);
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

export function KanbanBoard({ leads, onMove, onOpenLead, collapsedColumns = {}, onToggleColumn, columnCounts = {}, sortKey = 'ice', sortOrder = 'desc', onSortKeyChange, onSortOrderChange }: BoardProps) {
  const [isDragging, setIsDragging] = useState(false);
  const mode = useBreakpoint();
  const boardRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    leadId: string;
    startX: number;
    startY: number;
    ghost: HTMLDivElement | null;
    sourceColumn: KanbanColumn;
    sourceEl: HTMLElement | null;
  } | null>(null);

  const mobileVisibleColumn = useMemo(() => {
    if (mode !== 'mobile-portrait') return null;
    const visible = leads.find((l) => l.kanbanColumn === 'DISCOVERED');
    return (visible?.kanbanColumn || 'DISCOVERED') as KanbanColumn;
  }, [leads, mode]);

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

  const showAdvancedControls = mode !== 'mobile-portrait';

  const mobileColumnOptions = useMemo(() => COLUMNS.map((col) => ({ value: col.key, label: `${col.icon} ${col.label}` })), []);
  const mobileSelectedColumn = useMemo(() => {
    if (mode !== 'mobile-portrait') return null;
    const discovered = leads.find((l) => l.kanbanColumn === 'DISCOVERED');
    return discovered?.kanbanColumn || 'DISCOVERED';
  }, [leads, mode]);

  const visibleColumns = mode === 'mobile-portrait'
    ? COLUMNS.filter((col) => col.key === mobileSelectedColumn)
    : COLUMNS;

  const boardClass = `kanban-board kanban-board--${mode}`;
  const columnClass = (colKey: KanbanColumn) =>
    `kanban-column kanban-column--${mode}` + (collapsedColumns[colKey] ? ' kanban-column--collapsed' : '');

  const boardStyle: React.CSSProperties = {
    flex: '1 1 auto',
    height: 'auto',
    minHeight: 0,
  };

  const columnBaseStyle: React.CSSProperties = {
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: 'var(--mantine-color-gray-0)',
    borderRadius: tokens.radii.md,
    border: '1px solid var(--mantine-color-gray-3)',
  };

  return (
    <Box>
      {mode === 'mobile-portrait' && (
        <Box className="kanban-mobile-nav">
          <Select
            size="xs"
            value={mobileSelectedColumn || 'DISCOVERED'}
            onChange={(value) => {
              const next = (value as string) || 'DISCOVERED';
              const lead = leads.find((l) => l.kanbanColumn === next) || leads[0];
              if (lead) onOpenLead(lead);
            }}
            data={mobileColumnOptions}
            allowDeselect={false}
          />
        </Box>
      )}

      {showAdvancedControls && onSortKeyChange && onSortOrderChange && (
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
      )}

      <Box ref={boardRef} className={boardClass} style={boardStyle}>
        {visibleColumns.map((col) => {
          const colLeads = leadsInColumn(col.key);
          const color = semanticToneToMantineColor(col.color);
          const collapsed = Boolean(collapsedColumns[col.key]);

          const toggleColumn = () => {
            onToggleColumn?.(col.key);
          };

          return (
            <Box
              key={col.key}
              data-column={col.key}
              className={columnClass(col.key)}
              style={columnBaseStyle}
            >
              <Box
                style={{
                  padding: `${tokens.spacing.xs} ${tokens.spacing.md}`,
                  borderBottom: '1px solid var(--mantine-color-gray-2)',
                  borderTopLeftRadius: tokens.radii.md,
                  borderTopRightRadius: tokens.radii.md,
                  backgroundColor: col.key === 'WON' ? 'var(--mantine-color-green-6)' : col.key === 'LOST' ? 'var(--mantine-color-red-6)' : color,
                  color: '#fff',
                  flexShrink: 0,
                }}
              >
                <Group justify="space-between" align="center" gap="xs">
                  <Text fw={700} size="sm">
                    {col.label} ({columnCounts[col.key] ?? colLeads.length})
                  </Text>
                  <ActionIcon
                    size="xs"
                    variant="subtle"
                    color="white"
                    onClick={toggleColumn}
                    aria-label={collapsed ? 'Expand column' : 'Collapse column'}
                  >
                    {collapsed ? <IconChevronRight size={16} /> : <IconChevronDown size={16} />}
                  </ActionIcon>
                </Group>
              </Box>

              {!collapsed && (
                <Box className="kanban-column-body" style={{
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
        })}
      </Box>
    </Box>
  );
}
