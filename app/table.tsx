'use client';

import { AdminDataTable } from '@sovereignsquad/gds-admin/client';
import type { Lead } from './types';
import { getIceScore } from './constants';

type TableViewProps = {
  leads: Lead[];
};

export function TableView({ leads }: TableViewProps) {
  const rows = leads.map((lead) => ({
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
      getRowKey={(row) => row._id}
      renderMobileCard={(row) => (
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
