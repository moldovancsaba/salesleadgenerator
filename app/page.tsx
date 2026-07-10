"use client";

import { useEffect, useMemo, useState } from "react";
import { KanbanBoard } from "./kanban";
import { LeadDetailModal } from "./detail";
import { SearchLearningPanel } from "./search-learning";
import { MetricsPanel } from "./metrics";
import { COLUMNS } from "./constants";
import type { Lead, KanbanColumn } from "./types";

type Tab = "pipeline" | "search" | "metrics";

// ── Kanban Columns ─────────────────────────────────────────────────────────────
const KANBAN_COLUMNS: KanbanColumn[] = ["DISCOVERED", "QUALIFIED", "ENGAGED", "PROPOSAL", "WON", "LOST"];

export default function Home() {
  const [tab, setTab] = useState<Tab>("pipeline");
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [regionFilter, setRegionFilter] = useState<"ALL" | "US" | "CEE" | "MENA">("ALL");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Lead | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // ── Fetch leads ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const fetchLeads = async () => {
      try {
        setLoading(true);
        const params = new URLSearchParams();
        if (regionFilter !== "ALL") params.append("region", regionFilter);
        
        const res = await fetch(`/api/leads?${params.toString()}`);
        if (!res.ok) throw new Error("Failed to fetch leads");
        
        const data = await res.json();
        setLeads(data.leads || []);
      } catch (error) {
        console.error("Fetch error:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchLeads();
  }, [refreshKey, regionFilter]);

  // ── Filter by search ────────────────────────────────────────────────────────
  const filteredLeads = useMemo(() => {
    if (!search.trim()) return leads;
    
    const query = search.toLowerCase();
    return leads.filter((lead) => {
      return (
        lead.entity_name?.toLowerCase().includes(query) ||
        lead.industry?.toLowerCase().includes(query) ||
        lead.sport_or_sector?.toLowerCase().includes(query) ||
        lead.decision_maker_name?.toLowerCase().includes(query) ||
        lead.region?.toLowerCase().includes(query)
      );
    });
  }, [leads, search]);

  // ── Counts per column ───────────────────────────────────────────────────────
  const columnCounts = useMemo(() => {
    const counts: Record<KanbanColumn, number> = {
      DISCOVERED: 0,
      QUALIFIED: 0,
      ENGAGED: 0,
      PROPOSAL: 0,
      WON: 0,
      LOST: 0,
    };
    
    filteredLeads.forEach((lead) => {
      if (lead.kanbanColumn && counts[lead.kanbanColumn] !== undefined) {
        counts[lead.kanbanColumn]++;
      }
    });
    
    return counts;
  }, [filteredLeads]);

  // ── Region counts ───────────────────────────────────────────────────────────
  const regionCounts = useMemo(() => {
    const counts = {
      ALL: leads.length,
      US: 0,
      CEE: 0,
      MENA: 0,
    };
    
    leads.forEach((lead) => {
      if (lead.region === "US") counts.US++;
      else if (lead.region === "CEE") counts.CEE++;
      else if (lead.region === "MENA") counts.MENA++;
    });
    
    return counts;
  }, [leads]);

  // ── Move handler ────────────────────────────────────────────────────────────
  async function handleMove(leadId: string, column: KanbanColumn, sortOrder: number) {
    try {
      const res = await fetch(`/api/leads?id=${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kanbanColumn: column, sortOrder }),
      });
      
      if (!res.ok) throw new Error("Failed to move lead");
      
      setRefreshKey((k) => k + 1);
    } catch (error) {
      console.error("Move error:", error);
      alert("Failed to move lead. Please try again.");
    }
  }

  // ── Action handler (DECLINE, ACCEPT, etc) ───────────────────────────────────
  async function handleAction(leadId: string, action: "DECLINE" | "ACCEPT", payload: any) {
    try {
      const res = await fetch(`/api/leads?id=${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...payload }),
      });
      
      if (!res.ok) throw new Error("Failed to update lead");
      
      setSelected(null);
      setRefreshKey((k) => k + 1);
    } catch (error) {
      console.error("Action error:", error);
      alert("Failed to update lead. Please try again.");
    }
  }

  if (loading && leads.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-indigo-500 border-t-transparent"></div>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-[1600px] mx-auto px-6 py-4">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-2xl font-bold text-slate-900">CogMap Pipeline</h1>
            
            {/* Tab navigation */}
            <nav className="flex gap-1">
              {(["pipeline", "search", "metrics"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    tab === t
                      ? "bg-indigo-50 text-indigo-700"
                      : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </nav>
          </div>
          
          {/* Region filters and search */}
          <div className="flex items-center gap-4">
            <div className="flex gap-1">
              {(["ALL", "US", "CEE", "MENA"] as const).map((region) => (
                <button
                  key={region}
                  onClick={() => setRegionFilter(region)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    regionFilter === region
                      ? "bg-indigo-600 text-white"
                      : "bg-white text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  {region}
                  <span className="ml-2 text-xs opacity-70">
                    {regionCounts[region]}
                  </span>
                </button>
              ))}
            </div>
            
            <input
              type="text"
              placeholder="Search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 px-4 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        </div>
      </header>

      {/* ── Column Overview ─────────────────────────────────────────────────── */}
      <section className="bg-white border-b border-slate-200">
        <div className="max-w-[1600px] mx-auto px-6 py-4">
          <div className="grid grid-cols-6 gap-3">
            {KANBAN_COLUMNS.map((col) => {
              const meta = COLUMNS.find((c) => c.key === col)!;
              return (
                <div key={col} className="text-center">
                  <div className="text-3xl font-bold text-slate-900">
                    {columnCounts[col]}
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    {meta.icon} {meta.label}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Main Content ────────────────────────────────────────────────────── */}
      <div className="max-w-[1600px] mx-auto px-6 py-6">
        {tab === "pipeline" && (
          <KanbanBoard
            leads={filteredLeads}
            columns={COLUMNS}
            onMove={handleMove}
            onSelect={setSelected}
          />
        )}
        
        {tab === "search" && <SearchLearningPanel />}
        
        {tab === "metrics" && <MetricsPanel leads={leads} />}
      </div>

      {/* ── Detail Modal ────────────────────────────────────────────────────── */}
      {selected && (
        <LeadDetailModal
          lead={selected}
          onClose={() => setSelected(null)}
          onAction={(leadId, action, payload) => handleAction(leadId, action as any, payload)}
          onUpdated={() => {
            setSelected(null);
            setRefreshKey((k) => k + 1);
          }}
        />
      )}
    </main>
  );
}
