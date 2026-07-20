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

  const contactDetails = (lead: Lead) => {
    const parts = [lead.decision_maker_contact, lead.general_contact, lead.contact_phone].filter(Boolean);
    return parts.join(' · ') || '—';
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
              <th>Contact</th>
              <th>Contact details</th>
              <th>Value proposition</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((lead) => (
              <tr key={lead._id} onClick={() => onRowClick(lead)}>
                <td>{lead.entity_name}</td>
                <td>{ice(lead)}</td>
                <td>{lead.decision_maker_name || '—'}</td>
                <td>{contactDetails(lead)}</td>
                <td>{lead.value_proposition || '—'}</td>
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
          background: var(--mantine-color-gray-0);
        }
        .table-wrap {
          flex: 1;
          overflow: auto;
          padding: 0.75rem;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          font-size: 0.875rem;
          min-width: 720px;
        }
        th,
        td {
          text-align: left;
          padding: 0.6rem 0.75rem;
          border-bottom: 1px solid var(--mantine-color-gray-2);
          vertical-align: top;
        }
        th {
          position: sticky;
          top: 0;
          background: var(--mantine-color-gray-0);
          font-weight: 700;
          z-index: 1;
        }
        tbody tr {
          cursor: pointer;
        }
        tbody tr:hover {
          background: rgba(0, 0, 0, 0.03);
        }
        td:nth-child(5) {
          max-width: 40ch;
        }

        @media (max-width: 767px) {
          .table-wrap {
            padding: 0.5rem;
          }
          table {
            min-width: 640px;
            font-size: 0.8rem;
          }
          th,
          td {
            padding: 0.45rem 0.5rem;
          }
        }
      `}</style>
    </div>
  );
}
