"use client";

import type { KanbanColumn, Lead } from "../page";
import { LeadCard } from "./card";

type Props = {
  leads: Lead[];
  columns: { key: KanbanColumn; label: string; description: string; color: string; icon: string }[];
  onMove: (leadId: string, column: KanbanColumn, sortOrder: number) => void;
  onSelect: (lead: Lead) => void;
};

export function KanbanBoard({ leads, columns, onMove, onSelect }: Props) {
  const columnsData = columns.map((col) => ({
    ...col,
    leads: leads
      .filter((l) => l.kanbanColumn === col.key)
      .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)),
  }));

  function handleDragStart(e: React.DragEvent, lead: Lead) {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", JSON.stringify({
      leadId: lead._id,
      fromColumn: lead.kanbanColumn,
    }));
  }

  function handleDragOver(e: React.DragEvent, columnKey: KanbanColumn) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }

  function handleDrop(e: React.DragEvent, columnKey: KanbanColumn, targetIndex: number) {
    e.preventDefault();
    try {
      const data = JSON.parse(e.dataTransfer.getData("text/plain"));
      const leadId: string = data.leadId;
      const fromColumn: KanbanColumn = data.fromColumn;

      if (fromColumn === columnKey) return; // No-op within same column

      // Compute new sortOrder: insert at targetIndex position
      const columnLeads = columnsData
        .find((c) => c.key === columnKey)!
        .leads;

      const newSortOrder = computeSortOrder(columnLeads, targetIndex);
      onMove(leadId, columnKey, newSortOrder);
    } catch (err) {
      console.error("drop parse failed", err);
    }
  }

  function computeSortOrder(columnLeads: Lead[], targetIndex: number): number {
    if (columnLeads.length === 0) return 1000;
    if (targetIndex === 0) {
      return (columnLeads[0].sortOrder || 1000) - 500;
    }
    if (targetIndex >= columnLeads.length) {
      return (columnLeads[columnLeads.length - 1].sortOrder || 1000) + 500;
    }
    const before = columnLeads[targetIndex - 1].sortOrder || 1000;
    const after = columnLeads[targetIndex].sortOrder || 1000;
    return (before + after) / 2;
  }

  return (
    <div className="grid grid-cols-6 gap-3 overflow-x-auto">
      {columnsData.map((col) => (
        <div
          key={col.key}
          className="bg-white rounded-xl border border-slate-200 flex flex-col min-h-[600px]"
          onDragOver={(e) => handleDragOver(e, col.key)}
          onDrop={(e) => handleDrop(e, col.key, col.leads.length)}
        >
          {/* Column header */}
          <div className="px-3 py-2 border-b border-slate-100 bg-slate-50 rounded-t-xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-base">{col.icon}</span>
                <div>
                  <div className="text-sm font-semibold text-slate-900">{col.label}</div>
                  <div className="text-xs text-slate-500">{col.description}</div>
                </div>
              </div>
              <div className="text-xs font-bold text-slate-500 bg-slate-200 rounded-full px-2 py-0.5">
                {col.leads.length}
              </div>
            </div>
          </div>

          {/* Cards */}
          <div className="flex-1 p-2 space-y-2 overflow-y-auto">
            {col.leads.length === 0 ? (
              <div className="text-center text-xs text-slate-400 py-8">
                Drop leads here
              </div>
            ) : (
              col.leads.map((lead, idx) => (
                <div
                  key={lead._id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, lead)}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onDrop={(e) => {
                    e.stopPropagation();
                    handleDrop(e, col.key, idx);
                  }}
                  className="cursor-move"
                >
                  <LeadCard lead={lead} onClick={() => onSelect(lead)} />
                </div>
              ))
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
