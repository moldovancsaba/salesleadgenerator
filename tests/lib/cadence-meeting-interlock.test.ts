import { describe, it, expect, vi, beforeEach } from 'vitest';
import { bookSlot } from '@/app/lib/scheduling-store';
import { ObjectId } from 'mongodb';

// Mock integration-store and calendar calls
vi.mock('@/app/lib/integration-store', () => ({
  getActiveConnectionByProvider: vi.fn().mockResolvedValue({
    _id: 'conn-1',
    provider: 'google_calendar',
    status: 'active',
    userEmail: 'rep@brand.com',
  }),
  getUserConnection: vi.fn(),
  getValidCredential: vi.fn().mockResolvedValue('fake-access-token'),
  ConnectionRevokedError: class ConnectionRevokedError extends Error {},
}));

vi.mock('@/app/lib/brand', () => ({
  getBrandConfig: vi.fn().mockResolvedValue({
    key: 'cogmap',
    dbCollection: 'leads',
  }),
}));

vi.mock('@/lib/gcal-sync', () => ({
  deleteCalendarTaskReminder: vi.fn().mockResolvedValue({ ok: true }),
}));

describe('Cadence Meeting Interlock (Issue 295)', () => {
  let mockDb: any;
  let leadsCollection: any;
  let activityLogCollection: any;
  let claimsCollection: any;
  let leadDoc: any;

  beforeEach(() => {
    leadDoc = {
      _id: new ObjectId(),
      entity_name: 'FC Barcelona',
      country: 'Spain',
      tenantId: 'default',
      activeCadence: {
        cadenceId: 'cadence-sports-outreach',
        currentStepIndex: 1,
        status: 'active',
        stepDueAt: new Date(Date.now() + 86400000).toISOString(),
        taskStepId: 'task-remind-123',
      },
    };

    leadsCollection = {
      findOne: vi.fn().mockImplementation(async (query: any) => {
        if (query._id.toString() === leadDoc._id.toString()) {
          return { ...leadDoc };
        }
        return null;
      }),
      updateOne: vi.fn().mockImplementation(async (query: any, update: any) => {
        if (query._id.toString() === leadDoc._id.toString()) {
          if (update.$set) {
            Object.assign(leadDoc, update.$set);
          }
          return { modifiedCount: 1 };
        }
        return { modifiedCount: 0 };
      }),
    };

    activityLogCollection = {
      createIndex: vi.fn().mockResolvedValue('idx_created'),
      insertOne: vi.fn().mockResolvedValue({ insertedId: new ObjectId() }),
    };

    claimsCollection = {
      createIndex: vi.fn().mockResolvedValue('idx_claim'),
      insertOne: vi.fn().mockResolvedValue({ insertedId: new ObjectId() }),
      deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }),
    };

    mockDb = {
      collection: vi.fn().mockImplementation((name: string) => {
        if (name === 'leads') return leadsCollection;
        if (name === 'activityLog') return activityLogCollection;
        if (name === 'scheduling_slot_claims') return claimsCollection;
        if (name === 'scheduling_settings') {
          return {
            findOne: vi.fn().mockResolvedValue({
              timeZone: 'Europe/Budapest',
              availabilityWindow: { startHour: 9, endHour: 17, daysOfWeek: [1, 2, 3, 4, 5] },
            }),
            createIndex: vi.fn().mockResolvedValue('idx_sched_settings'),
          };
        }
        if (name === 'scheduling_rate_limits') {
          return {
            findOne: vi.fn().mockResolvedValue(null),
            createIndex: vi.fn().mockResolvedValue('idx_rate_limits'),
          };
        }
        if (name === 'integration_connections') {
          return {
            findOne: vi.fn().mockResolvedValue({
              _id: new ObjectId(),
              provider: 'google_calendar',
              status: 'active',
              authType: 'oauth2',
            }),
          };
        }
        return {
          findOne: vi.fn().mockResolvedValue(null),
          updateOne: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
          createIndex: vi.fn().mockResolvedValue('idx'),
        };
      }),
    };

    // Global fetch mock for Google Calendar freebusy and event creation
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockImplementation(async (url: string, init?: any) => {
      if (url.includes('/freeBusy')) {
        return new Response(JSON.stringify({ calendars: { primary: { busy: [] } } }), { status: 200 });
      }
      if (url.includes('/calendars/primary/events')) {
        return new Response(
          JSON.stringify({
            id: 'gcal-event-999',
            hangoutLink: 'https://meet.google.com/abc-defg-hij',
          }),
          { status: 200 }
        );
      }
      return originalFetch ? originalFetch(url, init) : new Response('{}', { status: 200 });
    });
  });

  it('stops active cadence, deletes task reminder, and logs activity when a meeting is booked', async () => {
    // Generate an unambiguously available slot on the next business day (Monday at 10:00 UTC)
    // to avoid weekend blackout slots in availability calculation
    const nextBusinessDay = new Date();
    // Advance at least 3 days to guarantee landing on next Monday/Tuesday
    const day = nextBusinessDay.getDay(); // 0 is Sun, 5 is Fri, 6 is Sat
    const daysToAdd = day === 5 ? 3 : (day === 6 ? 2 : 1);
    nextBusinessDay.setDate(nextBusinessDay.getDate() + daysToAdd);
    const dateStr = nextBusinessDay.toISOString().slice(0, 10);
    const slotStart = `${dateStr}T10:00:00.000Z`;
    const slotEnd = `${dateStr}T10:30:00.000Z`;

    const result = await bookSlot(mockDb, 'cogmap', 'default', {
      slotStart,
      slotEnd,
      leadId: leadDoc._id.toString(),
      prospectName: 'Mateu Alemany',
      prospectEmail: 'mateu@fcbarcelona.cat',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.meetingUrl).toBe('https://meet.google.com/abc-defg-hij');

    // Cadence should now be set to null on the lead
    expect(leadDoc.activeCadence).toBeNull();
    expect(leadDoc.nextActionDueAt).toBe(slotStart);
    expect(leadDoc.nextActionNote).toContain('Meeting scheduled');

    // Calendar task reminder cleanup called
    const { deleteCalendarTaskReminder } = await import('@/lib/gcal-sync');
    expect(deleteCalendarTaskReminder).toHaveBeenCalledWith(mockDb, {
      brand: 'cogmap',
      tenantId: 'default',
      taskId: 'task-remind-123',
    });

    // Activity log should have logged both the meeting and the cadence stoppage
    expect(activityLogCollection.insertOne).toHaveBeenCalled();
  });
});
