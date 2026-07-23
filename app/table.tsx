'use client';

import { AdminDataTable } from '@sovereignsquad/gds-admin/client';
import type { Lead } from './types';
import { getIceScore } from './constants';

type TableViewProps = {
  leads: Lead[];
};

type TableRow = Lead & { score: number };

export function TableView({ leads }: TableViewProps) {
  const rows: TableRow[] = leads.map((lead) => ({
    ...lead,
    score: getIceScore(lead),
  }));

  return (
    <AdminDataTable
      rows={rows}
      caption="Leads"
      columns={[
        { key: 'entity_name', header: 'Name', sortable: true },
        { key: 'score', header: 'Score', sortable: true },
        { key: 'region', header: 'Region', sortable: true },
        { key: 'qualityStatus', header: 'Quality', sortable: true },
        { key: 'kanbanColumn', header: 'Status', sortable: true },
      ]}
      getRowKey={(row: TableRow) => row._id}
      renderMobileCard={(row: TableRow) => (
        <div>
          <div style={{ fontWeight: 600 }}>{row.entity_name}</div>
          <div style={{ color: 'gray-6' }}>
            {row.region} • {row.qualityStatus || 'DRAFT'}
          </div>
        </div>
      )}
    />
  );
}
