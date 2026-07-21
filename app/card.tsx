'use client';

import type { Lead } from './types';
import { tokens } from './theme/tokens';
import { CardShell } from './components/ui/card-shell';
import { getIceScore } from './constants';

type LayoutMode = 'mobile-portrait' | 'mobile-landscape' | 'tablet-portrait' | 'tablet-landscape' | 'desktop';

interface LeadCardProps {
  lead: Lead;
  onOpen?: () => void;
  onMoveStart?: (e: React.PointerEvent) => void;
  onMove?: (e: React.PointerEvent) => void;
  onMoveEnd?: (e: React.PointerEvent) => void;
  isDragging?: boolean;
  now?: number;
  mode?: LayoutMode;
}

function formatAge(ms: number): string {
  const totalMinutes = Math.floor(ms / 60000);
  if (totalMinutes < 1) return 'now';
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const totalHours = Math.floor(totalMinutes / 60);
  if (totalHours < 24) return `${totalHours}h`;
  const totalDays = Math.floor(totalHours / 24);
  if (totalDays < 7) return `${totalDays}d`;
  const totalWeeks = Math.floor(totalDays / 7);
  if (totalWeeks < 4) return `${totalWeeks}w`;
  const totalMonths = Math.floor(totalDays / 30);
  if (totalMonths < 12) return `${totalMonths}mo`;
  return `${Math.floor(totalMonths / 12)}y`;
}

function formatTimestamp(value?: string): number | null {
  if (!value) return null;
  const time = Date.parse(value);
  if (Number.isNaN(time)) return null;
  return time;
}

function badgeStyle(base: Record<string, string>, extra: Record<string, string>) {
  return {
    padding: `${tokens.spacing.xs} ${tokens.spacing.sm}`,
    borderRadius: tokens.radii.sm,
    fontSize: tokens.typography.xs,
    fontWeight: 500,
    display: 'inline-flex',
    alignItems: 'center',
    lineHeight: 1.2,
    ...base,
    ...extra,
  };
}

export function LeadCard({ lead, onOpen, onMoveStart, onMove, onMoveEnd, isDragging = false, now = Date.now(), mode }: LeadCardProps) {
  const effectiveMode = mode || 'desktop';
  const ice = getIceScore(lead);
  const region = lead.region || 'US';
  const quality = lead.qualityStatus || 'DRAFT';

  const qualifiedAt = formatTimestamp(lead.qualifiedAt || lead.lastStatusChangeAt);
  const ageMs = qualifiedAt ? now - qualifiedAt : 0;
  const ageText = ageMs > 0 ? formatAge(ageMs) : null;
  const status = typeof lead.status === 'string' ? lead.status.toLowerCase() : null;
  const statusLabel = status === 'live' ? 'LIVE' : status ? status.toUpperCase() : 'NEW';
  const statusClassName = status === 'live' ? 'lead-card__status lead-card__status--live' : 'lead-card__status lead-card__status--draft';

  const isMobilePortrait = effectiveMode === 'mobile-portrait';
  const cardPadding = isMobilePortrait ? '0.75rem' : '0.5rem 0.75rem';

  const iceTone = ice >= 700 ? 'success' : ice >= 400 ? 'warning' : 'danger';
  const regionTone = region === 'USA' ? 'info' : 'neutral';
  const qualityTone = quality === 'VERIFIED' ? 'success' : quality === 'CHECKED' ? 'info' : 'neutral';

  return (
    <CardShell
      onClick={onOpen}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: tokens.spacing.sm,
        padding: cardPadding,
        cursor: isMobilePortrait ? 'pointer' : 'grab',
        touchAction: 'manipulation',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
        transition: 'transform 0.1s, box-shadow 0.1s',
        minHeight: isMobilePortrait ? 56 : 48,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: tokens.spacing.xs,
          color: 'var(--mantine-color-gray-5)',
          cursor: 'grab',
          flexShrink: 0,
          borderRadius: tokens.radii.sm,
          minHeight: 48,
          minWidth: 48,
        }}
        aria-label="Drag handle"
      >
        <svg width="20" height="24" viewBox="0 0 12 16" fill="none" style={{ display: 'block' }}>
          <circle cx="4" cy="3" r="1.8" fill="currentColor" />
          <circle cx="8" cy="3" r="1.8" fill="currentColor" />
          <circle cx="4" cy="8" r="1.8" fill="currentColor" />
          <circle cx="8" cy="8" r="1.8" fill="currentColor" />
          <circle cx="4" cy="13" r="1.8" fill="currentColor" />
          <circle cx="8" cy="13" r="1.8" fill="currentColor" />
        </svg>
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: tokens.typography.base,
          fontWeight: 600,
          color: 'var(--mantine-color-gray-9)',
          marginBottom: tokens.spacing.xs,
          lineHeight: tokens.lineHeights.normal,
          wordBreak: 'break-word',
        }}>
          {lead.entity_name}
        </div>

        <div style={{ display: 'flex', gap: tokens.spacing.xs, flexWrap: 'wrap', alignItems: 'center' }}>
          <span
            style={badgeStyle(
              { backgroundColor: 'var(--mantine-color-gray-1)', color: 'var(--mantine-color-gray-9)' },
              iceTone === 'success'
                ? { backgroundColor: 'var(--mantine-color-green-1)', color: 'var(--mantine-color-green-9)' }
                : iceTone === 'warning'
                  ? { backgroundColor: 'var(--mantine-color-yellow-1)', color: 'var(--mantine-color-yellow-9)' }
                  : { backgroundColor: 'var(--mantine-color-red-1)', color: 'var(--mantine-color-red-9)' }
            )}
          >
            {ice}
          </span>
          <span
            style={badgeStyle(
              { backgroundColor: 'var(--mantine-color-gray-1)', color: 'var(--mantine-color-gray-9)' },
              regionTone === 'info'
                ? { backgroundColor: 'var(--mantine-color-blue-1)', color: 'var(--mantine-color-blue-9)' }
                : {}
            )}
          >
            {region}
          </span>
          <span
            style={badgeStyle(
              { backgroundColor: 'var(--mantine-color-gray-1)', color: 'var(--mantine-color-gray-9)' },
              qualityTone === 'success'
                ? { backgroundColor: 'var(--mantine-color-teal-1)', color: 'var(--mantine-color-teal-9)' }
                : qualityTone === 'info'
                  ? { backgroundColor: 'var(--mantine-color-cyan-1)', color: 'var(--mantine-color-cyan-9)' }
                  : {}
            )}
          >
            {quality}
          </span>
          <span className={statusClassName}>{statusLabel}</span>
          {ageText && <span className="lead-card__age">{ageText}</span>}
          {lead.autoMoved && <span className="lead-card__auto-move">{lead.autoMoveNote || 'Auto'}</span>}
        </div>

        {lead.decision_maker_name && (
          <div style={{
            marginTop: tokens.spacing.xs,
            fontSize: tokens.typography.xs,
            color: 'var(--mantine-color-gray-6)',
            lineHeight: tokens.lineHeights.normal,
          }}>
            {lead.decision_maker_name}
            {lead.decision_maker_title && <span style={{ opacity: 0.7 }}> — {lead.decision_maker_title}</span>}
          </div>
        )}
      </div>
    </CardShell>
  );
}
