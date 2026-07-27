'use client';

import { Badge, Group, UnstyledButton } from '@mantine/core';
import { AdminDataTable } from '@sovereignsquad/gds-admin/client';
import type { Lead } from './types';
import { getIceScore } from './constants';

type TableViewProps = {
  leads: Lead[];
  onOpenLead: (lead: Lead) => void;
};

type TableRow = Lead & { score: number };

export function TableView({ leads, onOpenLead }: TableViewProps) {
  const rows: TableRow[] = leads.map((lead) => ({
    ...lead,
    score: getIceScore(lead),
  }));

  return (
    <AdminDataTable
      rows={rows}
      caption="Leads"
      columns={[
        {
          key: 'entity_name',
          header: 'Name',
          sortable: true,
          // AdminDataTable has no built-in row-click — only per-column accessor
          // rendering — so the Name cell itself is the tap target that opens
          // the detail modal, matching what the kanban card's tap already does.
          accessor: (row: TableRow) => (
            <UnstyledButton onClick={() => onOpenLead(row)} style={{ textAlign: 'left' }}>
              {row.entity_name}
            </UnstyledButton>
          ),
        },
        { key: 'score', header: 'Score', sortable: true },
        { key: 'region', header: 'Region', sortable: true },
        { key: 'qualityStatus', header: 'Quality', sortable: true },
        { key: 'kanbanColumn', header: 'Status', sortable: true },
        {
          key: 'tags',
          header: 'Tags',
          accessor: (row: TableRow) => (
            (row.tags?.length ?? 0) === 0 ? '—' : (
              <Group gap={4} wrap="wrap">
                {row.tags!.map((tag) => (<Badge key={tag} variant="outline" color="gray" size="xs">{tag}</Badge>))}
              </Group>
            )
          ),
        },
      ]}
      getRowKey={(row: TableRow) => row._id}
      renderMobileCard={(row: TableRow) => (
        <UnstyledButton onClick={() => onOpenLead(row)} style={{ display: 'block', width: '100%', textAlign: 'left' }}>
          <div style={{ fontWeight: 600 }}>{row.entity_name}</div>
          <div style={{ color: 'gray-6' }}>
            {row.region} • {row.qualityStatus || 'DRAFT'}
          </div>
        </UnstyledButton>
      )}
    />
  );
}
