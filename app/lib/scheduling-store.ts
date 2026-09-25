import type { Db } from 'mongodb';
import { ObjectId } from 'mongodb';
import { getActiveConnectionByProvider, getValidCredential, ConnectionRevokedError } from './integration-store';
import { fetchWithRetry } from '../../lib/integration-http';
import {
  computeAvailableSlots, isSlotStillAvailable, isRateLimited, isValidAvailabilityWindow,
  DEFAULT_AVAILABILITY_WINDOW, type AvailabilityWindow, type Slot, type BusyInterval,
} from '../../lib/scheduling';
import { ACTIVITY_LOG_COLLECTION, ensureActivityLogIndexes, type ActivityLogDocument } from './activity-log-store';
import { getBrandConfig, type Brand } from './brand';
import { tenantFilter } from '../../lib/tenant';

// Meeting scheduler (issue #207) — built directly on issue #217's
// third-party connection hub (its own §24 explicitly sanctions this
// ordering: "hub first, this issue second... build this issue's OAuth-
// connect flow directly on the shared integration_connections storage").
// No bespoke calendar_connections collection exists — 'google_calendar' is
// already a provider in the hub's own registry (lib/integration-connections.ts).
//
// Real, disclosed architectural note, same class as issue #216's: this
// issue's own text assumes a per-rep connection (keyed by ssoUserId, "one
// rep, one link"). The hub supports exactly one connection per
// {brand, tenantId, provider} — no per-rep dimension. This ships against
// that real schema: ONE shared booking calendar per brand, not one per
// rep — consistent with this issue's own §3 finding that "this app has no
// user/ownership model" at all. The booking link is /schedule/[brand], not
// a per-rep slug; no bookingSlug field/collection is introduced.

export const SCHEDULING_SETTINGS_COLLECTION = 'scheduling_settings';
export const SCHEDULING_RATE_LIMITS_COLLECTION = 'scheduling_rate_limits';
export const SCHEDULING_SLOT_CLAIMS_COLLECTION = 'scheduling_slot_claims';

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_PER_WINDOW = 20;
const SLOT_CLAIM_TTL_SECONDS = 30;

let indexesEnsured = false;
export async function ensureSchedulingIndexes(db: Db): Promise<void> {
  if (indexesEnsured) return;
  try {
    await db.collection(SCHEDULING_SETTINGS_COLLECTION).createIndex({ brand: 1, tenantId: 1 }, { unique: true });
    await db.collection(SCHEDULING_RATE_LIMITS_COLLECTION).createIndex({ createdAt: 1 }, { expireAfterSeconds: Math.ceil(RATE_LIMIT_WINDOW_MS / 1000) + 5 });
    await db.collection(SCHEDULING_RATE_LIMITS_COLLECTION).createIndex({ key: 1, createdAt: 1 });
    await db.collection(SCHEDULING_SLOT_CLAIMS_COLLECTION).createIndex({ brand: 1, tenantId: 1, slotStart: 1 }, { unique: true });
    await db.collection(SCHEDULING_SLOT_CLAIMS_COLLECTION).createIndex({ createdAt: 1 }, { expireAfterSeconds: SLOT_CLAIM_TTL_SECONDS });
    indexesEnsured = true;
  } catch (error) {
    console.error('[scheduling-store] index creation failed', error);
  }
}

export type SchedulingSettings = { timeZone: string; availabilityWindow: AvailabilityWindow };

export async function getSchedulingSettings(db: Db, brand: string, tenantId: string): Promise<SchedulingSettings> {
  const doc = await db.collection(SCHEDULING_SETTINGS_COLLECTION).findOne({ brand, tenantId });
  if (!doc) return { timeZone: 'UTC', availabilityWindow: DEFAULT_AVAILABILITY_WINDOW };
  return {
    timeZone: typeof doc.timeZone === 'string' ? doc.timeZone : 'UTC',
    availabilityWindow: isValidAvailabilityWindow(doc.availabilityWindow) ? doc.availabilityWindow : DEFAULT_AVAILABILITY_WINDOW,
  };
}

export async function saveSchedulingSettings(db: Db, brand: string, tenantId: string, settings: SchedulingSettings): Promise<void> {
  await ensureSchedulingIndexes(db);
  await db.collection(SCHEDULING_SETTINGS_COLLECTION).updateOne(
    { brand, tenantId },
    { $set: { ...settings, updatedAt: new Date().toISOString() } },
    { upsert: true }
  );
}

// Returns true when the request is ALLOWED. Inserts a record for this
// request unconditionally (whether allowed or not), so repeated hammering
// is itself reflected in the count until the TTL index expires it — never
// a busy in-memory counter, which wouldn't survive across the separate
// serverless invocations Vercel gives each request.
export async function checkAndRecordRateLimit(db: Db, key: string): Promise<boolean> {
  await ensureSchedulingIndexes(db);
  const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
  const recentCount = await db.collection(SCHEDULING_RATE_LIMITS_COLLECTION).countDocuments({ key, createdAt: { $gte: windowStart } });
  await db.collection(SCHEDULING_RATE_LIMITS_COLLECTION).insertOne({ key, createdAt: new Date() });
  return !isRateLimited(recentCount, RATE_LIMIT_MAX_PER_WINDOW);
}

const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3';

async function fetchFreeBusy(token: string, rangeStart: string, rangeEnd: string): Promise<BusyInterval[]> {
  const res = await fetchWithRetry(`${CALENDAR_API_BASE}/freeBusy`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ timeMin: rangeStart, timeMax: rangeEnd, items: [{ id: 'primary' }] }),
  });
  if (!res.ok) throw new Error(`freeBusy request failed: ${res.status}`);
  const body = await res.json();
  const busy = body.calendars?.primary?.busy || [];
  return busy.map((b: any) => ({ start: b.start, end: b.end }));
}

async function createCalendarEvent(token: string, params: { start: string; end: string; summary: string; attendeeEmail: string }): Promise<{ id: string } | null> {
  const res = await fetchWithRetry(`${CALENDAR_API_BASE}/calendars/primary/events`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      summary: params.summary,
      start: { dateTime: params.start },
      end: { dateTime: params.end },
      attendees: [{ email: params.attendeeEmail }],
    }),
  });
  if (!res.ok) return null;
  return res.json();
}

export type AvailabilityResult =
  | { ok: true; slots: Slot[] }
  | { ok: false; status: 404 | 503; error: string };

export async function getAvailability(db: Db, brand: Brand, tenantId: string, days: number): Promise<AvailabilityResult> {
  const connection = await getActiveConnectionByProvider(db, brand, tenantId, 'google_calendar');
  if (!connection) return { ok: false, status: 404, error: 'This scheduling link is not available right now' };

  let token: string;
  try {
    token = await getValidCredential(db, connection);
  } catch {
    return { ok: false, status: 503, error: 'This scheduling link is temporarily unavailable' };
  }

  const settings = await getSchedulingSettings(db, brand, tenantId);
  const rangeStart = new Date().toISOString();
  const rangeEnd = new Date(Date.now() + Math.min(Math.max(days, 1), 30) * 24 * 60 * 60 * 1000).toISOString();

  let busy: BusyInterval[];
  try {
    busy = await fetchFreeBusy(token, rangeStart, rangeEnd);
  } catch {
    return { ok: false, status: 503, error: 'This scheduling link is temporarily unavailable' };
  }

  const slots = computeAvailableSlots({ rangeStart, rangeEnd, timeZone: settings.timeZone, window: settings.availabilityWindow, busy });
  return { ok: true, slots };
}

export type BookingResult =
  | { ok: true; startAt: string; endAt: string }
  | { ok: false; status: 404 | 409 | 503; error: string; freshSlots?: Slot[] };

// Race-safe commit (issue #207 §11/§15): a short-lived, unique-indexed
// "slot claim" document closes the TOCTOU gap between the freshness
// re-check and the Google event-create call — a concurrent second booking
// attempt for the identical slot fails the unique-index insert instantly
// (E11000), never a silent double-book. The claim's own TTL (30s) is
// deliberately short: it exists only to win the race at submission time,
// not as the system of record for "is this slot booked" (Google Calendar's
// own freeBusy state is, re-checked fresh on every request).
export async function bookSlot(db: Db, brand: Brand, tenantId: string, params: {
  slotStart: string; slotEnd: string; leadId?: string; prospectName: string; prospectEmail: string;
}): Promise<BookingResult> {
  const connection = await getActiveConnectionByProvider(db, brand, tenantId, 'google_calendar');
  if (!connection) return { ok: false, status: 404, error: 'This scheduling link is not available right now' };

  let token: string;
  try {
    token = await getValidCredential(db, connection);
  } catch {
    return { ok: false, status: 503, error: 'This scheduling link is temporarily unavailable' };
  }

  const settings = await getSchedulingSettings(db, brand, tenantId);
  const rangeStart = new Date().toISOString();
  const rangeEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  let freshSlots: Slot[];
  try {
    const busy = await fetchFreeBusy(token, rangeStart, rangeEnd);
    freshSlots = computeAvailableSlots({ rangeStart, rangeEnd, timeZone: settings.timeZone, window: settings.availabilityWindow, busy });
  } catch {
    return { ok: false, status: 503, error: 'This scheduling link is temporarily unavailable' };
  }

  if (!isSlotStillAvailable({ start: params.slotStart, end: params.slotEnd }, freshSlots)) {
    return { ok: false, status: 409, error: 'That time is no longer available', freshSlots };
  }

  await ensureSchedulingIndexes(db);
  try {
    await db.collection(SCHEDULING_SLOT_CLAIMS_COLLECTION).insertOne({ brand, tenantId, slotStart: params.slotStart, createdAt: new Date() });
  } catch (error: any) {
    if (error?.code === 11000) return { ok: false, status: 409, error: 'That time is no longer available', freshSlots };
    throw error;
  }

  const event = await createCalendarEvent(token, {
    start: params.slotStart, end: params.slotEnd,
    summary: `Meeting: ${params.prospectName}`,
    attendeeEmail: params.prospectEmail,
  });
  if (!event) return { ok: false, status: 409, error: 'That time is no longer available', freshSlots };

  await ensureActivityLogIndexes(db);
  const activityDoc: ActivityLogDocument = {
    leadId: params.leadId || null,
    tenantId, brand,
    type: 'meeting-scheduled',
    direction: null,
    matchedContactKey: null,
    source: 'calendar-sync',
    meetingStartAt: params.slotStart,
    meetingEndAt: params.slotEnd,
    meetingProvider: 'google',
    meetingEventId: event.id,
    meetingBookedByEmail: params.prospectEmail,
    createdAt: new Date(),
  } as ActivityLogDocument;
  await db.collection(ACTIVITY_LOG_COLLECTION).insertOne(activityDoc as any);

  if (params.leadId && ObjectId.isValid(params.leadId)) {
    const brandConfig = await getBrandConfig(brand);
    if (brandConfig) {
      await db.collection(brandConfig.dbCollection).updateOne(
        { _id: new ObjectId(params.leadId), ...tenantFilter(tenantId) },
        { $set: { nextActionDueAt: params.slotStart, nextActionNote: `Meeting scheduled for ${params.slotStart}`, updatedAt: new Date().toISOString() } }
      ).catch((error) => {
        // The prospect's booking must never fail because of internal-app
        // state (issue #207 §15) — logged for manual follow-up, not thrown.
        console.error('[scheduling-store] lead write-back failed', error);
      });
    }
  }

  return { ok: true, startAt: params.slotStart, endAt: params.slotEnd };
}

export { ConnectionRevokedError };
