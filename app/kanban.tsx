'use client';

import { useState } from 'react';
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
  const [dragData, setDragData] = useState<{ leadId: string; fromColumn: KanbanColumn } | null>(null);
  const [dropTarget, setDropTarget] = useState<KanbanColumn | null>(null);

  function leadsInColumn(col: KanbanColumn): Lead[] {
    return leads
      .filter((l) => l.kanbanColumn === col)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  }

  async function handleDrop(targetColumn: KanbanColumn) {
    if (!dragData) return;
    if (dragData.fromColumn === targetColumn) {
      setDragData(null);
      setDropTarget(null);
      return;
    }
    const colLeads = leadsInColumn(targetColumn);
    const newSortOrder = colLeads.length > 0
      ? Math.max(...colLeads.map((l) => l.sortOrder ?? 0)) + 10
      : 0;
    await onMove(dragData.leadId, targetColumn, newSortOrder);
    setDragData(null);
    setDropTarget(null);
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
    <>
      <Group gap="sm" align="flex-start" wrap="nowrap" style={{ overflowX: 'auto', overflowY: 'hidden', minHeight: 520, paddingBottom: '0.5rem' }}>
        {COLUMNS.map((col) => {
          const colLeads = leadsInColumn(col.key);
          const color = semanticToneToMantineColor(col.color);
          const isDropTarget = dropTarget === col.key;

          return (
            <Stack key={col.key} gap="xs" style={{ flex: '0 0 280px', minWidth: 240 }}>
              <Group justify="space-between" align="center">
                <Text fw={600} size="sm" tt="uppercase">
                  {col.label}
                </Text>
                <Badge variant="light" color={color} size="sm">
                  {colLeads.length}
                </Badge>
              </Group>

              <Card
                padding="xs"
                radius="md"
                withBorder
                style={{
                  minHeight: 420,
                  backgroundColor: isDropTarget ? `var(--mantine-color-${color}-1)` : `var(--mantine-color-${color}-0)`,
                  border: isDropTarget ? `2px dashed var(--mantine-color-${color}-5)` : undefined,
                  transition: 'all 0.2s ease',
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDropTarget(col.key);
                }}
                onDragLeave={() => setDropTarget(null)}
                onDrop={() => handleDrop(col.key)}
              >
                <Stack gap="xs">
                  {colLeads.map((lead) => (
                    <LeadCard
                      key={lead._id}
                      lead={lead}
                      onClick={() => setSelectedLead(lead)}
                      onDragStart={() =>
                        setDragData({ leadId: lead._id, fromColumn: lead.kanbanColumn })
                      }
                    />
                  ))}
                  {colLeads.length === 0 && (
                    <Text size="xs" c="dimmed" ta="center" py="xl">
                      {col.description}
                    </Text>
                  )}
                </Stack>
              </Card>
            </Stack>
          );
        })}
      </Group>

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
