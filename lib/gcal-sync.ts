/**
 * Google Calendar Task Reminders Sync
 * (Predecessor CRM Ingestion Phase 8 / Handoff 08 - issue #244).
 *
 * Connects manual sequence tasks (call, linkedin, general) and follow-up reminders
 * to Google Calendar via the third-party connection hub (lib/integration-connections.ts).
 *
 * Invariants:
 * 1. Deterministic event IDs derived from task UUIDs so retries never create duplicate events.
 * 2. Completion in the CRM workbench is canonical; Google Calendar is reminder-only.
 * 3. Cancelled sequence tasks delete future Google Calendar events; completed tasks keep them.
 * 4. Calendar failure does not fail CRM task creation or cadence progression (non-blocking).
 */

import type { Db } from 'mongodb';
import { getActiveConnectionByProvider, getValidCredential } from '../app/lib/integration-store';
import { fetchWithRetry } from './integration-http';

export const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3';
export const CALENDAR_SYNC_SETTINGS_COLLECTION = 'calendar_sync_settings';

export type CalendarSyncSettings = {
  syncEnabled: boolean;
  defaultDurationMinutes: number;
  autoSyncCadenceTasks: boolean;
};

export const DEFAULT_CALENDAR_SYNC_SETTINGS: CalendarSyncSettings = {
  syncEnabled: true,
  defaultDurationMinutes: 30,
  autoSyncCadenceTasks: true,
};

/**
 * Derives a deterministic Google Calendar event ID from a CRM task or step ID.
 * Google Calendar event ID requirement: characters must be [a-v0-9], length 5-1024 chars.
 * Retries reuse this ID so a retry/restart cannot mint a second event.
 */
export function deriveCalendarEventId(taskId: string): string {
  if (!taskId || typeof taskId !== 'string') {
    return 'slgtaskdefault';
  }
  // Sanitize: only characters [a-v0-9] are permitted in Google Calendar event IDs
  const clean = taskId.toLowerCase().replace(/[^a-v0-9]/g, '');
  const idStr = `slg${clean}`.slice(0, 64);
  return idStr.length >= 5 ? idStr : `${idStr}00000`.slice(0, 5);
}

/**
 * Builds Google Calendar event times given a due date and duration.
 */
export function computeEventTimes(
  dueAt: string | Date | undefined,
  durationMinutes = 30
): { start: string; end: string } {
  let startDate: Date;
  if (!dueAt) {
    startDate = new Date();
  } else if (dueAt instanceof Date) {
    startDate = dueAt;
  } else {
    const parsed = new Date(dueAt);
    startDate = isNaN(parsed.getTime()) ? new Date() : parsed;
  }

  const durationMs = Math.max(1, durationMinutes) * 60 * 1000;
  const endDate = new Date(startDate.getTime() + durationMs);

  return {
    start: startDate.toISOString(),
    end: endDate.toISOString(),
  };
}

/**
 * Formats a clean, readable calendar event title with contact and company context.
 */
export function formatEventSummary(params: {
  title: string;
  contactName?: string;
  companyName?: string;
}): string {
  const baseTitle = (params.title || 'CRM Task').trim();
  const contact = (params.contactName || '').trim();
  const company = (params.companyName || '').trim();

  const parts = [baseTitle];
  if (contact && !baseTitle.toLowerCase().includes(contact.toLowerCase())) {
    parts.push(contact);
  }
  if (company && !baseTitle.toLowerCase().includes(company.toLowerCase())) {
    parts.push(company);
  }

  return parts.join(' - ');
}

/**
 * Builds a structured, rep-actionable calendar event description.
 */
export function formatEventDescription(params: {
  title: string;
  channel?: string;
  contactName?: string;
  contactEmail?: string;
  companyName?: string;
  instructions?: string;
  brand: string;
  leadId: string;
  appUrl?: string;
}): string {
  const lines: string[] = [`CRM Task: ${params.title.trim()}`];

  if (params.channel) {
    lines.push(`Channel: ${params.channel.toUpperCase()}`);
  }

  if (params.contactName || params.contactEmail) {
    lines.push('');
    lines.push('Contact:');
    if (params.contactName) lines.push(`Name: ${params.contactName}`);
    if (params.contactEmail) lines.push(`Email: ${params.contactEmail}`);
  }

  if (params.companyName) {
    lines.push('');
    lines.push(`Company: ${params.companyName}`);
  }

  if (params.instructions) {
    lines.push('');
    lines.push(`Instructions:\n${params.instructions.trim()}`);
  }

  const baseUrl = (params.appUrl || process.env.APP_URL || process.env.NEXTAUTH_URL || 'https://sales.haho.ai').replace(/\/$/, '');
  lines.push('');
  lines.push(`Open in Rep Workbench:\n${baseUrl}/today/${params.brand}`);

  return lines.join('\n');
}

/**
 * Constructs the full Google Calendar event payload.
 */
export function buildCalendarEventPayload(params: {
  taskId: string;
  title: string;
  dueAt: string;
  durationMinutes?: number;
  channel?: string;
  contactName?: string;
  contactEmail?: string;
  companyName?: string;
  instructions?: string;
  brand: string;
  leadId: string;
  appUrl?: string;
}) {
  const eventId = deriveCalendarEventId(params.taskId);
  const times = computeEventTimes(params.dueAt, params.durationMinutes);
  const summary = formatEventSummary({
    title: params.title,
    contactName: params.contactName,
    companyName: params.companyName,
  });
  const description = formatEventDescription(params);

  return {
    id: eventId,
    summary,
    description,
    start: { dateTime: times.start },
    end: { dateTime: times.end },
  };
}

/**
 * Loads calendar sync settings for a brand.
 */
export async function getCalendarSyncSettings(
  db: Db,
  brand: string,
  tenantId: string
): Promise<CalendarSyncSettings> {
  const doc = await db.collection(CALENDAR_SYNC_SETTINGS_COLLECTION).findOne({ brand, tenantId });
  if (!doc) return { ...DEFAULT_CALENDAR_SYNC_SETTINGS };
  return {
    syncEnabled: doc.syncEnabled !== false,
    defaultDurationMinutes:
      typeof doc.defaultDurationMinutes === 'number' && doc.defaultDurationMinutes > 0
        ? doc.defaultDurationMinutes
        : DEFAULT_CALENDAR_SYNC_SETTINGS.defaultDurationMinutes,
    autoSyncCadenceTasks: doc.autoSyncCadenceTasks !== false,
  };
}

/**
 * Synchronizes a CRM task reminder to Google Calendar.
 * Fails safely without throwing so CRM task progression is never blocked.
 */
export async function syncTaskReminderToGoogleCalendar(
  db: Db,
  params: {
    brand: string;
    tenantId: string;
    taskId: string;
    title: string;
    dueAt: string;
    durationMinutes?: number;
    channel?: string;
    contactName?: string;
    contactEmail?: string;
    companyName?: string;
    instructions?: string;
    leadId: string;
    appUrl?: string;
  }
): Promise<{ synced: boolean; eventId?: string; reason?: string }> {
  try {
    const settings = await getCalendarSyncSettings(db, params.brand, params.tenantId);
    if (!settings.syncEnabled) {
      return { synced: false, reason: 'calendar_sync_disabled' };
    }

    const connection = await getActiveConnectionByProvider(
      db,
      params.brand,
      params.tenantId,
      'google_calendar'
    );
    if (!connection) {
      return { synced: false, reason: 'not_connected' };
    }

    let token: string;
    try {
      token = await getValidCredential(db, connection);
    } catch (tokenErr: any) {
      return { synced: false, reason: `credential_error: ${tokenErr?.message || 'invalid token'}` };
    }

    const payload = buildCalendarEventPayload({
      ...params,
      durationMinutes: params.durationMinutes || settings.defaultDurationMinutes,
    });

    // Idempotent upsert: Try PUT directly with the deterministic event ID.
    // If not found (404), POST to /events with the ID.
    const putUrl = `${CALENDAR_API_BASE}/calendars/primary/events/${payload.id}`;
    const putRes = await fetchWithRetry(putUrl, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (putRes.ok) {
      return { synced: true, eventId: payload.id };
    }

    if (putRes.status === 404) {
      // Event does not exist yet: create via POST
      const postUrl = `${CALENDAR_API_BASE}/calendars/primary/events`;
      const postRes = await fetchWithRetry(postUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (postRes.ok) {
        return { synced: true, eventId: payload.id };
      }

      const errBody = await postRes.text().catch(() => '');
      return {
        synced: false,
        reason: `google_calendar_create_failed (${postRes.status}): ${errBody.slice(0, 100)}`,
      };
    }

    const errBody = await putRes.text().catch(() => '');
    return {
      synced: false,
      reason: `google_calendar_update_failed (${putRes.status}): ${errBody.slice(0, 100)}`,
    };
  } catch (err: any) {
    // Fail closed for calendar but safe for CRM: return error reason without throwing
    return { synced: false, reason: err?.message || 'calendar_sync_exception' };
  }
}

/**
 * Deletes a Google Calendar reminder event when a task is cancelled.
 * Fails safely without throwing.
 */
export async function deleteCalendarTaskReminder(
  db: Db,
  params: {
    brand: string;
    tenantId: string;
    taskId: string;
  }
): Promise<{ deleted: boolean; reason?: string }> {
  try {
    const connection = await getActiveConnectionByProvider(
      db,
      params.brand,
      params.tenantId,
      'google_calendar'
    );
    if (!connection) {
      return { deleted: false, reason: 'not_connected' };
    }

    let token: string;
    try {
      token = await getValidCredential(db, connection);
    } catch {
      return { deleted: false, reason: 'credential_error' };
    }

    const eventId = deriveCalendarEventId(params.taskId);
    const deleteUrl = `${CALENDAR_API_BASE}/calendars/primary/events/${eventId}`;

    const res = await fetchWithRetry(deleteUrl, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    // 204 No Content, 200 OK, or 404 Not Found are all successful deletion outcomes
    if (res.ok || res.status === 404) {
      return { deleted: true };
    }

    return { deleted: false, reason: `delete_failed_${res.status}` };
  } catch (err: any) {
    return { deleted: false, reason: err?.message || 'calendar_delete_exception' };
  }
}
