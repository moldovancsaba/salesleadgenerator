'use client';

import { useState, useMemo } from 'react';
import { Box, Button, Group, Text, UnstyledButton } from '@mantine/core';
import { AdminDataTable, type AdminDataTableSort } from '@sovereignsquad/gds-admin/client';
import { StatusBadge, LabelTag, CountBadge } from '@sovereignsquad/gds-core/client';
import type { Lead } from './types';
import { getIceScore, getTicketSize, type TicketSizeDisplay } from './constants';
import type { CurrencyCode } from './lib/brand';

type TableViewProps = {
  leads: Lead[];
  onOpenLead: (lead: Lead) => void;
};

type TableRow = Lead & {
  score: number;
  ticketSize: TicketSizeDisplay;
  valueNumeric: number;
  primaryContactName: string;
  primaryContactEmail: string;
};

const STAGE_COLORS: Record<string, string> = {
  DISCOVERED: 'blue',
  QUALIFIED: 'indigo',
  ENGAGED: 'green',
  PROPOSAL: 'orange',
  WON: 'teal',
  LOST: 'red',
  BACKLOG: 'gray',
};

function formatCompactTicketSize(value: number, currency: CurrencyCode): string {
  const symbol = currency === 'USD' ? '$' : '€';
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${symbol}${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${symbol}${Math.round(value / 1000)}K`;
  return `${symbol}${Math.round(value)}`;
}

function getTicketSizeDisplay(ticketSize: TicketSizeDisplay): string {
  if (!ticketSize || ticketSize.kind === 'unconfigured') return '—';
  if (ticketSize.kind === 'estimate') return `~${formatCompactTicketSize(ticketSize.expected, ticketSize.currency)}`;
  return `~${formatCompactTicketSize(ticketSize.value, ticketSize.currency)}`;
}

function getQualityBadgeColor(status?: string): string {
  switch (status?.toUpperCase()) {
    case 'VERIFIED':
      return 'teal';
    case 'CHECKED':
      return 'blue';
    default:
      return 'gray';
  }
}

export function TableView({ leads, onOpenLead }: TableViewProps) {
  const [sort, setSort] = useState<AdminDataTableSort>({ key: 'score', direction: 'desc' });

  const rows: TableRow[] = useMemo(() => {
    return leads.map((lead) => {
      const score = getIceScore(lead);
      const ticketSize = getTicketSize(lead);
      let valueNumeric = 0;
      if (ticketSize && ticketSize.kind === 'estimate') {
        valueNumeric = ticketSize.expected;
      } else if (ticketSize && ticketSize.kind === 'legacy') {
        valueNumeric = ticketSize.value;
      }
      const primaryContact = (lead.contacts && lead.contacts[0]) || null;
      return {
        ...lead,
        score,
        ticketSize,
        valueNumeric,
        primaryContactName: primaryContact?.name || '',
        primaryContactEmail: primaryContact?.email || '',
      };
    });
  }, [leads]);

  const sortedRows = useMemo(() => {
    const list = [...rows];
    list.sort((a, b) => {
      let cmp = 0;
      if (sort.key === 'entity_name') {
        cmp = (a.entity_name || '').localeCompare(b.entity_name || '');
      } else if (sort.key === 'valueNumeric' || sort.key === 'value') {
        cmp = a.valueNumeric - b.valueNumeric;
      } else if (sort.key === 'score') {
        cmp = a.score - b.score;
      } else if (sort.key === 'kanbanColumn' || sort.key === 'stage') {
        cmp = (a.kanbanColumn || '').localeCompare(b.kanbanColumn || '');
      } else if (sort.key === 'region') {
        cmp = (a.region || '').localeCompare(b.region || '');
      } else if (sort.key === 'qualityStatus') {
        cmp = (a.qualityStatus || '').localeCompare(b.qualityStatus || '');
      } else if (sort.key === 'primaryContactName' || sort.key === 'contact') {
        cmp = (a.primaryContactName || '').localeCompare(b.primaryContactName || '');
      } else if (sort.key === 'assignedTo') {
        cmp = (a.assignedTo || '').localeCompare(b.assignedTo || '');
      }
      return sort.direction === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [rows, sort]);

  return (
    <Box w="100%" style={{ overflowX: 'auto' }}>
      <AdminDataTable<TableRow>
        rows={sortedRows}
        caption={`Showing ${sortedRows.length} leads`}
        sort={sort}
        onSortChange={setSort}
        columns={[
          {
            key: 'entity_name',
            header: 'Lead Name',
            rowHeader: true,
            sortable: true,
            width: 240,
            accessor: (row: TableRow) => (
              <Box>
                <UnstyledButton
                  onClick={() => onOpenLead(row)}
                  style={{ textAlign: 'left', display: 'block' }}
                >
                  <Text fw={600} size="sm" c="indigo" style={{ cursor: 'pointer' }}>
                    {row.entity_name}
                  </Text>
                </UnstyledButton>
                {(row.sport_or_sector || row.industry || row.parentOrgName) && (
                  <Text size="xs" c="dimmed" truncate style={{ maxWidth: 220 }}>
                    {row.sport_or_sector || row.industry || row.parentOrgName}
                  </Text>
                )}
              </Box>
            ),
          },
          {
            key: 'valueNumeric',
            header: 'Deal Value',
            sortable: true,
            width: 120,
            accessor: (row: TableRow) => (
              <Text size="sm" fw={600} c={row.valueNumeric > 0 ? undefined : 'dimmed'}>
                {getTicketSizeDisplay(row.ticketSize)}
              </Text>
            ),
          },
          {
            key: 'kanbanColumn',
            header: 'Stage',
            sortable: true,
            width: 120,
            accessor: (row: TableRow) => (
              <StatusBadge
                size="xs"
                status={row.kanbanColumn === 'WON' ? 'success' : row.kanbanColumn === 'LOST' ? 'danger' : 'neutral'}
              >
                {row.kanbanColumn || 'DISCOVERED'}
              </StatusBadge>
            ),
          },
          {
            key: 'score',
            header: 'ICE Score',
            sortable: true,
            width: 95,
            accessor: (row: TableRow) => (
              <CountBadge
                size="xs"
                value={row.score}
                srLabel="ICE Score"
              />
            ),
          },
          {
            key: 'primaryContactName',
            header: 'Primary Contact',
            sortable: true,
            width: 220,
            accessor: (row: TableRow) => {
              if (!row.primaryContactName && !row.primaryContactEmail) {
                return <Text size="sm" c="dimmed">—</Text>;
              }
              return (
                <Box>
                  {row.primaryContactName && (
                    <Text size="sm" fw={500} truncate style={{ maxWidth: 200 }}>
                      {row.primaryContactName}
                    </Text>
                  )}
                  {row.primaryContactEmail && (
                    <Text
                      component="a"
                      href={`mailto:${row.primaryContactEmail}`}
                      size="xs"
                      c="blue"
                      style={{ textDecoration: 'none' }}
                      truncate
                    >
                      {row.primaryContactEmail}
                    </Text>
                  )}
                </Box>
              );
            },
          },
          {
            key: 'assignedTo',
            header: 'Assignee',
            sortable: true,
            width: 130,
            accessor: (row: TableRow) => (
              row.assignedTo ? (
                <LabelTag size="xs" tone="info" label={row.assignedTo} />
              ) : (
                <Text size="xs" c="dimmed">—</Text>
              )
            ),
          },
          {
            key: 'region',
            header: 'Region',
            sortable: true,
            width: 90,
            accessor: (row: TableRow) => (
              <LabelTag size="xs" tone="neutral" label={row.region || 'NA'} />
            ),
          },
          {
            key: 'qualityStatus',
            header: 'Quality',
            sortable: true,
            width: 100,
            accessor: (row: TableRow) => (
              <StatusBadge
                size="xs"
                status={row.qualityStatus === 'VERIFIED' ? 'success' : row.qualityStatus === 'CHECKED' ? 'info' : 'neutral'}
              >
                {row.qualityStatus || 'DRAFT'}
              </StatusBadge>
            ),
          },
          {
            key: 'tags',
            header: 'Tags',
            width: 140,
            accessor: (row: TableRow) => {
              const tags = row.tags || [];
              if (tags.length === 0) return <Text size="xs" c="dimmed">—</Text>;
              return (
                <Group gap={4} wrap="wrap">
                  {tags.slice(0, 2).map((t) => (
                    <LabelTag key={t} size="xs" tone="neutral" label={t} />
                  ))}
                  {tags.length > 2 && (
                    <LabelTag size="xs" tone="neutral" label={`+${tags.length - 2}`} />
                  )}
                </Group>
              );
            },
          },
          {
            key: 'actions',
            header: '',
            width: 80,
            align: 'end',
            accessor: (row: TableRow) => (
              <Button
                size="xs"
                variant="light"
                color="indigo"
                onClick={() => onOpenLead(row)}
              >
                Open
              </Button>
            ),
          },
        ]}
        getRowKey={(row: TableRow) => row._id}
        renderMobileCard={(row: TableRow) => (
          <UnstyledButton
            onClick={() => onOpenLead(row)}
            style={{ display: 'block', width: '100%', textAlign: 'left' }}
          >
            <Group justify="space-between" align="flex-start" wrap="nowrap">
              <div>
                <Text fw={600} size="sm">{row.entity_name}</Text>
                <Text size="xs" c="dimmed">{row.region} • {row.qualityStatus || 'DRAFT'}</Text>
              </div>
              <StatusBadge
                size="xs"
                status={row.kanbanColumn === 'WON' ? 'success' : row.kanbanColumn === 'LOST' ? 'danger' : 'neutral'}
              >
                {row.kanbanColumn}
              </StatusBadge>
            </Group>
            {row.valueNumeric > 0 && (
              <Text size="xs" fw={600} mt={4}>
                {getTicketSizeDisplay(row.ticketSize)}
              </Text>
            )}
          </UnstyledButton>
        )}
      />
    </Box>
  );
}
