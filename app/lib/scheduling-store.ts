import type { Db } from 'mongodb';
import { ObjectId } from 'mongodb';
import { randomBytes } from 'crypto';
import { getActiveConnectionByProvider, getUserConnection, getValidCredential, ConnectionRevokedError } from './integration-store';
import { fetchWithRetry } from '../../lib/integration-http';
import {
  computeAvailableSlots, isSlotStillAvailable, isRateLimited, isValidAvailabilityWindow,
  DEFAULT_AVAILABILITY_WINDOW, buildGoogleMeetEventPayload, extractGoogleMeetUrl,
  type AvailabilityWindow, type Slot, type BusyInterval,
} from '../../lib/scheduling';
import type { IntegrationConnection } from '../../lib/integration-connections';
import { ACTIVITY_LOG_COLLECTION, ensureActivityLogIndexes, type ActivityLogDocument } from './activity-log-store';
import { getBrandConfig, type Brand } from './brand';
import { tenantFilter } from '../../lib/tenant';
import { deleteCalendarTaskReminder } from '../../lib/gcal-sync';

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

async function createCalendarEvent(
  token: string,
  params: { start: string; end: string; summary: string; attendeeEmail: string }
): Promise<{ id: string; meetingUrl?: string } | null> {
  const requestId = `meet_${randomBytes(8).toString('hex')}`;
  const payload = buildGoogleMeetEventPayload({
    ...params,
    requestId,
  });
  const res = await fetchWithRetry(`${CALENDAR_API_BASE}/calendars/primary/events?conferenceDataVersion=1`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) return null;
  const body = await res.json();
  return {
    id: body.id,
    meetingUrl: extractGoogleMeetUrl(body),
  };
}

// Issue #279 — resolves the assigned rep's personal google_calendar connection
// first when the booking is tied to a lead with assignedTo / assignedToEmail,
// falling back to the brand-level google_calendar connection.
async function resolveSchedulingCalendarConnection(
  db: Db,
  brand: Brand,
  tenantId: string,
  leadId?: string
): Promise<{ connection: IntegrationConnection | null; hostEmail?: string }> {
  if (leadId && ObjectId.isValid(leadId)) {
    const config = await getBrandConfig(brand);
    if (config) {
      const leadDoc = await db.collection(config.dbCollection).findOne(
        { _id: new ObjectId(leadId), ...tenantFilter(tenantId) },
        { projection: { assignedTo: 1, assignedToEmail: 1 } }
      );
      const assignedUserId = typeof leadDoc?.assignedTo === 'string' && leadDoc.assignedTo.trim()
        ? leadDoc.assignedTo.trim()
        : undefined;
      const assignedEmail = typeof leadDoc?.assignedToEmail === 'string' && leadDoc.assignedToEmail.trim()
        ? leadDoc.assignedToEmail.trim()
        : undefined;
      if (assignedUserId) {
        const repConn = await getUserConnection(db, assignedUserId, 'google_calendar', assignedEmail);
        if (repConn) {
          return { connection: repConn, hostEmail: repConn.userEmail || assignedEmail };
        }
      }
    }
  }
  const brandConn = await getActiveConnectionByProvider(db, brand, tenantId, 'google_calendar');
  return { connection: brandConn, hostEmail: brandConn?.userEmail };
}

export type AvailabilityResult =
  | { ok: true; slots: Slot[]; hostEmail?: string }
  | { ok: false; status: 404 | 503; error: string };

export async function getAvailability(
  db: Db,
  brand: Brand,
  tenantId: string,
  days: number,
  leadId?: string
): Promise<AvailabilityResult> {
  const { connection, hostEmail } = await resolveSchedulingCalendarConnection(db, brand, tenantId, leadId);
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
  return { ok: true, slots, hostEmail };
}

export type BookingResult =
  | { ok: true; startAt: string; endAt: string; meetingUrl?: string; hostEmail?: string }
  | { ok: false; status: 404 | 409 | 503; error: string; freshSlots?: Slot[] };

// Race-safe commit (issue #207 §11/§15): a short-lived, unique-indexed
// "slot claim" document closes the TOCTOU gap between the freshness
// re-check and the Google event-create call — a concurrent second booking
// attempt for the identical slot fails the unique-index insert instantly
// (E11000), never a silent double-book. The claim's own TTL (30s) is
// deliberately short: it exists only to win the race at submission time,
// not as the system of record for "is this slot booked" (Google Calendar's
// own freeBusy state is, re-checked fresh on every request).
// Issue #229: a scheduling link used to carry the lead's raw _id, and
// booking wrote the meeting back onto whatever lead that id named. ObjectIds
// are partly predictable, so anyone with one link could guess a neighbouring
// lead's id. A link now carries a random 128-bit token stored on the lead;
// only a token that resolves attributes a booking to a lead.
const LINK_TOKEN_RE = /^[0-9a-f]{32}$/;

export async function getOrCreateSchedulingLinkToken(db: Db, brand: Brand, tenantId: string, leadId: string): Promise<string | null> {
  const config = await getBrandConfig(brand);
  if (!config || !ObjectId.isValid(leadId)) return null;
  const collection = db.collection(config.dbCollection);
  const filter = { _id: new ObjectId(leadId), ...tenantFilter(tenantId) };
  const lead = await collection.findOne(filter, { projection: { schedulingLinkToken: 1 } });
  if (!lead) return null;
  if (typeof lead.schedulingLinkToken === 'string') return lead.schedulingLinkToken;
  // Set only if still absent, then re-read, so two concurrent requests
  // settle on one token instead of the second overwriting a link already
  // handed out.
  await collection.updateOne(
    { ...filter, schedulingLinkToken: { $exists: false } },
    { $set: { schedulingLinkToken: randomBytes(16).toString('hex') } }
  );
  const fresh = await collection.findOne(filter, { projection: { schedulingLinkToken: 1 } });
  return typeof fresh?.schedulingLinkToken === 'string' ? fresh.schedulingLinkToken : null;
}

export async function resolveSchedulingLinkToken(db: Db, brand: Brand, tenantId: string, token: unknown): Promise<string | undefined> {
  if (typeof token !== 'string' || !LINK_TOKEN_RE.test(token)) return undefined;
  const config = await getBrandConfig(brand);
  if (!config) return undefined;
  const lead = await db.collection(config.dbCollection).findOne(
    { schedulingLinkToken: token, ...tenantFilter(tenantId) },
    { projection: { _id: 1 } }
  );
  return lead ? String(lead._id) : undefined;
}

export async function bookSlot(db: Db, brand: Brand, tenantId: string, params: {
  slotStart: string; slotEnd: string; leadId?: string; prospectName: string; prospectEmail: string;
}): Promise<BookingResult> {
  const { connection, hostEmail } = await resolveSchedulingCalendarConnection(db, brand, tenantId, params.leadId);
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
  let claimId: unknown;
  try {
    const claim = await db.collection(SCHEDULING_SLOT_CLAIMS_COLLECTION).insertOne({ brand, tenantId, slotStart: params.slotStart, createdAt: new Date() });
    claimId = claim.insertedId;
  } catch (error: any) {
    if (error?.code === 11000) return { ok: false, status: 409, error: 'That time is no longer available', freshSlots };
    throw error;
  }

  let event: { id: string; meetingUrl?: string } | null;
  try {
    event = await createCalendarEvent(token, {
      start: params.slotStart, end: params.slotEnd,
      summary: `Meeting: ${params.prospectName}`,
      attendeeEmail: params.prospectEmail,
    });
  } catch {
    await db.collection(SCHEDULING_SLOT_CLAIMS_COLLECTION).deleteOne({ _id: claimId as any }).catch(() => {});
    return { ok: false, status: 503, error: 'This scheduling link is temporarily unavailable' };
  }
  if (!event) {
    await db.collection(SCHEDULING_SLOT_CLAIMS_COLLECTION).deleteOne({ _id: claimId as any }).catch(() => {});
    return { ok: false, status: 409, error: 'That time is no longer available', freshSlots };
  }

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
    ...(event.meetingUrl ? { meetingUrl: event.meetingUrl } : {}),
    createdAt: new Date(),
  } as ActivityLogDocument;
  await db.collection(ACTIVITY_LOG_COLLECTION).insertOne(activityDoc as any);

  if (params.leadId && ObjectId.isValid(params.leadId)) {
    const brandConfig = await getBrandConfig(brand);
    if (brandConfig) {
      const leadObjId = new ObjectId(params.leadId);
      try {
        const existingLead = await db.collection(brandConfig.dbCollection).findOne({
          _id: leadObjId,
          ...tenantFilter(tenantId),
        });

        // Auto-stop active cadence and clean up pending reminders (Issue #295)
        if (existingLead?.activeCadence) {
          if (existingLead.activeCadence.taskStepId) {
            await deleteCalendarTaskReminder(db, {
              brand,
              tenantId,
              taskId: existingLead.activeCadence.taskStepId,
            }).catch(() => {});
          }

          // Record cadence cancellation activity
          const stopDoc: ActivityLogDocument = {
            leadId: params.leadId,
            tenantId,
            brand,
            type: 'system',
            direction: null,
            matchedContactKey: null,
            source: 'calendar-sync',
            subject: 'Cadence sequence stopped: meeting booked',
            createdAt: new Date(),
          } as ActivityLogDocument;
          await db.collection(ACTIVITY_LOG_COLLECTION).insertOne(stopDoc as any).catch(() => {});
        }

        await db.collection(brandConfig.dbCollection).updateOne(
          { _id: leadObjId, ...tenantFilter(tenantId) },
          {
            $set: {
              activeCadence: null,
              nextActionDueAt: params.slotStart,
              nextActionNote: `Meeting scheduled for ${params.slotStart}${event.meetingUrl ? ` (${event.meetingUrl})` : ''}`,
              updatedAt: new Date().toISOString(),
            },
          }
        );
      } catch (error) {
        console.error('[scheduling-store] lead write-back or cadence auto-stop failed', error);
      }
    }
  }

  return {
    ok: true,
    startAt: params.slotStart,
    endAt: params.slotEnd,
    meetingUrl: event.meetingUrl,
    hostEmail,
  };
}

export { ConnectionRevokedError };
