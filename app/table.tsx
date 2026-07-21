'use client';

import { useMemo } from 'react';
import { DataTable, DataTableColumn } from '@doneisbetter/gds-admin/client';
import type { Lead } from './types';

type TableViewProps = {
  leads: Lead[];
  onRowClick: (lead: Lead) => void;
  sortKey?: 'ice' | 'name';
  sortOrder?: 'asc' | 'desc';
};

export function TableView({ leads, onRowClick, sortKey = 'ice', sortOrder = 'desc' }: TableViewProps) {
  const ice = (lead: Lead) => {
    if (lead.scoreProfile?.finalBlended?.ice != null) return lead.scoreProfile.finalBlended.ice;
    if (lead.ice) return lead.ice.impact * lead.ice.confidence * lead.ice.ease;
    return 0;
  };

  const sorted = useMemo(() => {
    const list = [...leads];
    list.sort((a, b) => {
      if (sortKey === 'name') {
        const an = (a.entity_name || '').toLowerCase();
        const bn = (b.entity_name || '').toLowerCase();
        return sortOrder === 'asc' ? an.localeCompare(bn) : bn.localeCompare(an);
      }
      const ia = ice(a);
      const ib = ice(b);
      return sortOrder === 'asc' ? ia - ib : ib - ia;
    });
    return list;
  }, [leads, sortKey, sortOrder]);

  const columns: DataTableColumn<Lead>[] = [
    {
      key: 'entity_name',
      label: 'Name',
      render: (value) => String(value ?? ''),
    },
    {
      key: 'score',
      label: 'Score',
      render: (item) => String(ice(item)),
    },
    {
      key: 'kanbanColumn',
      label: 'Status',
      render: (value) => String(value ?? ''),
    },
  ];

  return (
    <DataTable
      data={sorted}
      columns={columns}
      getRowKey={(row) => row._id}
      loading={false}
    />
  );
}
