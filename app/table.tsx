'use client';

import { Lead } from './types';

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

  const sorted = [...leads].sort((a, b) => {
    if (sortKey === 'name') {
      const an = (a.entity_name || '').toLowerCase();
      const bn = (b.entity_name || '').toLowerCase();
      return sortOrder === 'asc' ? an.localeCompare(bn) : bn.localeCompare(an);
    }
    const ia = ice(a);
    const ib = ice(b);
    return sortOrder === 'asc' ? ia - ib : ib - ia;
  });

  return (
    <div className="table-view">
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Score</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((lead) => (
              <tr key={lead._id} onClick={() => onRowClick(lead)}>
                <td>{lead.entity_name}</td>
                <td>{ice(lead)}</td>
                <td>{lead.kanbanColumn}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <style jsx>{`
        .table-view {
          minHeight: 100dvh;
          overflow: auto;
          display: flex;
          flex-direction: column;
          background: #f4f6f8;
        }
        .table-wrap {
          flex: 1;
          overflow: auto;
          padding: 0.75rem;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          font-size: 0.9rem;
          min-width: 320px;
        }
        th,
        td {
          text-align: left;
          padding: 0.65rem 0.75rem;
          border-bottom: 1px solid #d7dce3;
          vertical-align: top;
          color: #111827;
        }
        th {
          position: sticky;
          top: 0;
          background: #e5e7eb;
          font-weight: 700;
          z-index: 1;
          color: #111827;
        }
        tbody tr {
          cursor: pointer;
        }
        tbody tr:hover {
          background: #eef2f7;
        }
        td:nth-child(2) {
          min-width: 70px;
        }
        td:nth-child(3) {
          min-width: 100px;
        }

        @media (max-width: 767px) {
          .table-wrap {
            padding: 0.5rem;
          }
          table {
            min-width: 280px;
            font-size: 0.85rem;
          }
          th,
          td {
            padding: 0.55rem 0.6rem;
          }
        }
      `}</style>
    </div>
  );
}
