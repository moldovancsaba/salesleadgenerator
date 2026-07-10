"use client";

import { useEffect, useMemo, useState } from "react";
import { KanbanBoard } from "./kanban";
import { LeadDetailModal } from "./detail";
import { SearchLearningPanel } from "./search";
import { MetricsPanel } from "./metrics";

// ── Types (mirror models/Lead.ts) ───────────────────────────────────────────
export type KanbanColumn =
  | "DISCOVERED"
  | "QUALIFIED"
  | "ENGAGED"
  | "PROPOSAL"
  | "WON"
  | "LOST";

export type QualityStatus = "DRAFT" | "CHECKED" | "VERIFIED";
export type DeclineReason =
  | "WRONG_INDUSTRY"
  | "NO_DECISION_MAKER"
  | "TOO_SMALL"
  | "ALREADY_COMPETITOR"
  | "BAD_TIMING"
  | "BUDGET_CONSTRAINTS"
  | "NOT_RESPONSIVE"
  | "MISSING_CONTEXT"
  | "LOW_PRIORITY"
  | "OTHER";

export type Lead = {
  _id: string;
  id?: number;
  region: "US" | "CEE" | "MENA";
  entity_name: string;
  url?: string;
  address?: string;
  general_contact?: string;
  size?: string;
  industry?: string;
  sport_or_sector?: string;
  level_league?: string;
  decision_maker_name?: string;
  decision_maker_title?: string;
  decision_maker_contact?: string;
  pro_for_cogmap?: string[];
  con_for_cogmap?: string[];
  value_proposition?: string;
  priority?: "high" | "medium" | "low";
  status?: string;
  notes?: string;
  tags?: string[];
  kanbanColumn: KanbanColumn;
  sortOrder: number;
  fingerprint?: string;
  ice?: { impact: number; confidence: number; ease: number };
  scoreProfile?: any;
  qualityStatus: QualityStatus;
  feedbackScore: number;
  declineCount: number;
  acceptanceCount: number;
  declineReason?: DeclineReason;
  declinedAt?: string;
  manualLaneOverrideAt?: string;
  manualLaneCooldownUntil?: string;
  manualLaneFloorColumn?: string;
  manualLaneOverrideBy?: string;
  lastActionAt?: string;
  createdAt?: string;
  updatedAt?: string;
};

// ── Column metadata (Check-inspired) ────────────────────────────────────────
export const COLUMNS: { key: KanbanColumn; label: string; description: string; color: string; icon: string }[] = [
  { key: "DISCOVERED", label: "Discovered", description: "Raw discovery queue", color: "slate", icon: "🔍" },
  { key: "QUALIFIED", label: "Qualified", description: "Fit confirmed, ICE ≥ 200", color: "blue", icon: "✓" },
  { key: "ENGAGED", label: "Engaged", description: "Active outreach, ICE ≥ 480", color: "indigo", icon: "⚡" },
  { key: "PROPOSAL", label: "Proposal", description: "In negotiation", color: "purple", icon: "📝" },
  { key: "WON", label: "Won", description: "Closed positive", color: "emerald", icon: "🏆" },
  { key: "LOST", label: "Lost", description: "Declined / no fit", color: "rose", icon: "✕" },
];

type Tab = "pipeline" | "search" | "metrics";

export default function Home() {
  const [tab, setTab] = useState<Tab>("pipeline");
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [regionFilter, setRegionFilter] = useState<"ALL" | "US" | "CEE" | "MENA">("ALL");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Lead | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // ── Fetch ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const params = new URLSearchParams({ limit: "500" });
        const res = await fetch(`/api/leads?${params.toString()}`);
        const data = await res.json();
        setLeads(data.leads || []);
      } catch (err) {
        console.error("fetch leads failed", err);
      } finally {
        setLoading(false);
      }
    })();
  }, [refreshKey]);

  // ── Filter + Search ────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return leads.filter((l) => {
      if (regionFilter !== "ALL" && l.region !== regionFilter) return false;
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        l.entity_name.toLowerCase().includes(q) ||
        l.industry?.toLowerCase().includes(q) ||
        l.sport_or_sector?.toLowerCase().includes(q) ||
        l.region.toLowerCase().includes(q)
      );
    });
  }, [leads, regionFilter, search]);

  // ── Counts ─────────────────────────────────────────────────────────────────
  const counts = useMemo(() => {
    const c: Record<KanbanColumn, number> = {
      DISCOVERED: 0, QUALIFIED: 0, ENGAGED: 0, PROPOSAL: 0, WON: 0, LOST: 0,
    };
    filtered.forEach((l) => { c[l.kanbanColumn]++; });
    return c;
  }, [filtered]);

  // ── Move handler ───────────────────────────────────────────────────────────
  async function handleMove(leadId: string, column: KanbanColumn, sortOrder: number) {
    setLeads((prev) =>
      prev.map((l) =>
        l._id === leadId ? { ...l, kanbanColumn: column, sortOrder } : l
      )
    );
    try {
      await fetch(`/api/leads?id=${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kanbanColumn: column, sortOrder }),
      });
    } catch (err) {
      console.error("move failed", err);
      setRefreshKey((k) => k + 1);
    }
  }

  // ── Action handler (ACCEPT / DECLINE / PIN / etc.) ────────────────────────
  async function handleAction(
    leadId: string,
    action: "ACCEPT" | "DECLINE" | "MODIFY" | "PIN" | "REQUEST_REFRESH",
    payload: any = {}
  ) {
    try {
      const res = await fetch(`/api/leads?id=${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...payload }),
      });
      const data = await res.json();
      if (data.lead) {
        setLeads((prev) => prev.map((l) => (l._id === leadId ? data.lead : l)));
        setSelected(data.lead);
      } else {
        setRefreshKey((k) => k + 1);
      }
    } catch (err) {
      console.error("action failed", err);
      setRefreshKey((k) => k + 1);
    }
  }

  function handleLeadUpdated() {
    setRefreshKey((k) => k + 1);
    setSelected(null);
  }

  // ── Region counts for top filters ──────────────────────────────────────────
  const regionCounts = useMemo(() => {
    const total = leads.length;
    return {
      ALL: total,
      US: leads.filter((l) => l.region === "US").length,
      CEE: leads.filter((l) => l.region === "CEE").length,
      MENA: leads.filter((l) => l.region === "MENA").length,
    };
  }, [leads]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-4 border-slate-200 border-t-indigo-600 mx-auto mb-4"></div>
          <p className="text-slate-600 font-medium">Loading pipeline from MongoDB…</p>
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-[1600px] mx-auto px-6 py-5">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
                CogMap Sales Pipeline
              </h1>
              <p className="text-sm text-slate-500 mt-1">
                {leads.length} leads • Check-inspired Kanban • ICE scoring • Structured decline
              </p>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
              {([
                { id: "pipeline", label: "Pipeline" },
                { id: "search", label: "Search Learning" },
                { id: "metrics", label: "Metrics" },
              ] as { id: Tab; label: string }[]).map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`px-4 py-1.5 text-sm font-medium rounded-md transition ${
                    tab === t.id ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Region filter + search */}
          <div className="mt-4 flex items-center gap-3 flex-wrap">
            <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
              {(["ALL", "US", "CEE", "MENA"] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => setRegionFilter(r)}
                  className={`px-3 py-1 text-sm font-medium rounded-md transition ${
                    regionFilter === r ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  {r} <span className="text-xs text-slate-400 ml-1">{regionCounts[r]}</span>
                </button>
              ))}
            </div>

            <input
              type="text"
              placeholder="Search entity, industry, sector…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 min-w-[200px] px-4 py-1.5 bg-slate-100 border-0 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        </div>
      </div>

      {/* ── Content ─────────────────────────────────────────────────────────── */}
      <div className="max-w-[1600px] mx-auto px-6 py-6">
        {tab === "pipeline" && (
          <>
            {/* Column counts strip */}
            <div className="grid grid-cols-6 gap-2 mb-4">
              {COLUMNS.map((c) => (
                <div key={c.key} className="bg-white rounded-lg border border-slate-200 px-3 py-2">
                  <div className="text-xs text-slate-500 font-medium">
                    {c.icon} {c.label}
                  </div>
                  <div className="text-2xl font-bold text-slate-900">{counts[c.key]}</div>
                </div>
              ))}
            </div>

            <KanbanBoard
              leads={filtered}
              columns={COLUMNS}
              onMove={handleMove}
              onSelect={setSelected}
            />
          </>
        )}

        {tab === "search" && <SearchLearningPanel />}
        {tab === "metrics" && <MetricsPanel leads={leads} />}
      </div>

      {/* ── Detail Modal ────────────────────────────────────────────────────── */}
      {selected && (
        <LeadDetailModal
          lead={selected}
          onClose={() => setSelected(null)}
          onAction={handleAction}
          onUpdated={handleLeadUpdated}
        />
      )}

      <footer className="max-w-[1600px] mx-auto px-6 pb-6 text-center text-xs text-slate-400">
        CogMap Sales Pipeline • MongoDB Atlas • Vercel • Check-inspired architecture
      </footer>
    </main>
  );
}
