"use client";

import { Lead } from "./types";

type TableViewProps = {
  leads: Lead[];
  onRowClick: (lead: Lead) => void;
};

export function TableView({ leads, onRowClick }: TableViewProps) {
  const score = (lead: Lead) => {
    if (lead.scoreProfile?.finalBlended?.ice != null) {
      return lead.scoreProfile.finalBlended.ice;
    }
    if (lead.ice) {
      return lead.ice.impact * lead.ice.confidence * lead.ice.ease;
    }
    return 0;
  };

  const contactDetails = (lead: Lead) => {
    const parts = [lead.decision_maker_contact, lead.general_contact, lead.contact_phone].filter(Boolean);
    return parts.join(" · ") || "—";
  };

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
            {leads.map((lead) => (
              <tr key={lead._id} onClick={() => onRowClick(lead)}>
                <td>{lead.entity_name}</td>
                <td>{score(lead)}</td>
                <td>{lead.decision_maker_name || "—"}</td>
                <td>{contactDetails(lead)}</td>
                <td>{lead.value_proposition || "—"}</td>
                <td>{lead.kanbanColumn}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <style jsx>{`
        .table-view {
          height: 100dvh;
          overflow: hidden;
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
      `}</style>
    </div>
  );
}
