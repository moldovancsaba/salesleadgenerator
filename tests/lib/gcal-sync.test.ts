import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  deriveCalendarEventId,
  computeEventTimes,
  formatEventSummary,
  formatEventDescription,
  buildCalendarEventPayload,
  syncTaskReminderToGoogleCalendar,
  deleteCalendarTaskReminder,
} from '@/lib/gcal-sync';
import { getActiveConnectionByProvider, getValidCredential } from '@/app/lib/integration-store';
import { fetchWithRetry } from '@/lib/integration-http';

vi.mock('@/lib/integration-http', () => ({
  fetchWithRetry: vi.fn(),
}));

vi.mock('@/app/lib/integration-store', () => ({
  getActiveConnectionByProvider: vi.fn(),
  getValidCredential: vi.fn(),
}));

const mockedFetchWithRetry = vi.mocked(fetchWithRetry);
const mockedGetActiveConnection = vi.mocked(getActiveConnectionByProvider);
const mockedGetValidCredential = vi.mocked(getValidCredential);

describe('Google Calendar Task Reminders Sync (issue 244)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('deriveCalendarEventId', () => {
    it('produces deterministic ID adhering to Google Calendar event ID format [a-v0-9]', () => {
      const taskId = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
      const eventId = deriveCalendarEventId(taskId);

      expect(eventId.startsWith('slg')).toBe(true);
      expect(/^[a-v0-9]{5,1024}$/.test(eventId)).toBe(true);
      expect(deriveCalendarEventId(taskId)).toBe(eventId);
    });

    it('sanitizes special characters and dashes', () => {
      const eventId = deriveCalendarEventId('TASK_CALL_123-abc-XYZ');
      expect(/^[a-v0-9]+$/.test(eventId)).toBe(true);
    });

    it('ensures minimum 5 characters length for short IDs', () => {
      const eventId = deriveCalendarEventId('a');
      expect(eventId.length).toBeGreaterThanOrEqual(5);
      expect(/^[a-v0-9]+$/.test(eventId)).toBe(true);
    });
  });

  describe('computeEventTimes', () => {
    it('defaults to 30 minutes duration from given due date', () => {
      const dueAt = '2026-10-15T10:00:00.000Z';
      const times = computeEventTimes(dueAt, 30);

      expect(times.start).toBe('2026-10-15T10:00:00.000Z');
      expect(times.end).toBe('2026-10-15T10:30:00.000Z');
    });

    it('honors custom duration minutes', () => {
      const dueAt = '2026-10-15T14:00:00.000Z';
      const times = computeEventTimes(dueAt, 45);

      expect(times.start).toBe('2026-10-15T14:00:00.000Z');
      expect(times.end).toBe('2026-10-15T14:45:00.000Z');
    });
  });

  describe('formatEventSummary', () => {
    it('combines title, contact name, and company without duplication', () => {
      expect(
        formatEventSummary({
          title: 'Follow-up Call',
          contactName: 'Sarah Connor',
          companyName: 'Cyberdyne',
        })
      ).toBe('Follow-up Call - Sarah Connor - Cyberdyne');
    });

    it('avoids repeating contact name if already in title', () => {
      expect(
        formatEventSummary({
          title: 'Call with Sarah Connor',
          contactName: 'Sarah Connor',
          companyName: 'Cyberdyne',
        })
      ).toBe('Call with Sarah Connor - Cyberdyne');
    });
  });

  describe('formatEventDescription', () => {
    it('formats instructions, channel, and deep link to rep workbench', () => {
      const desc = formatEventDescription({
        title: 'Pitch Review Call',
        channel: 'call',
        contactName: 'John Doe',
        contactEmail: 'john@example.com',
        companyName: 'Acme Corp',
        instructions: 'Discuss enterprise pricing',
        brand: 'cogmap',
        leadId: 'lead-123',
        appUrl: 'https://leads.haho.ai',
      });

      expect(desc).toContain('CRM Task: Pitch Review Call');
      expect(desc).toContain('Channel: CALL');
      expect(desc).toContain('Contact:\nName: John Doe\nEmail: john@example.com');
      expect(desc).toContain('Company: Acme Corp');
      expect(desc).toContain('Instructions:\nDiscuss enterprise pricing');
      expect(desc).toContain('https://leads.haho.ai/today/cogmap');
    });
  });

  describe('buildCalendarEventPayload', () => {
    it('builds full Google Calendar event object', () => {
      const payload = buildCalendarEventPayload({
        taskId: 'task-abc-123',
        title: 'Intro Meeting',
        dueAt: '2026-10-20T09:00:00.000Z',
        durationMinutes: 30,
        channel: 'general',
        brand: 'cogmap',
        leadId: 'lead-1',
      });

      expect(payload.id).toBe(deriveCalendarEventId('task-abc-123'));
      expect(payload.summary).toBe('Intro Meeting');
      expect(payload.start.dateTime).toBe('2026-10-20T09:00:00.000Z');
      expect(payload.end.dateTime).toBe('2026-10-20T09:30:00.000Z');
      expect(payload.description).toContain('CRM Task: Intro Meeting');
    });
  });

  describe('syncTaskReminderToGoogleCalendar', () => {
    function createMockDb(settingsDoc: any = null) {
      return {
        collection: () => ({
          findOne: async () => settingsDoc,
        }),
      } as any;
    }

    it('returns not_connected gracefully when provider is not active', async () => {
      const mockDb = createMockDb();
      mockedGetActiveConnection.mockResolvedValueOnce(null);

      const res = await syncTaskReminderToGoogleCalendar(mockDb, {
        brand: 'cogmap',
        tenantId: 'default',
        taskId: 'task-1',
        title: 'Follow-up',
        dueAt: '2026-10-20T10:00:00.000Z',
        leadId: 'lead-1',
      });

      expect(res.synced).toBe(false);
      expect(res.reason).toBe('not_connected');
    });

    it('returns calendar_sync_disabled when syncEnabled is toggled false', async () => {
      const mockDb = createMockDb({ syncEnabled: false });

      const res = await syncTaskReminderToGoogleCalendar(mockDb, {
        brand: 'cogmap',
        tenantId: 'default',
        taskId: 'task-1',
        title: 'Follow-up',
        dueAt: '2026-10-20T10:00:00.000Z',
        leadId: 'lead-1',
      });

      expect(res.synced).toBe(false);
      expect(res.reason).toBe('calendar_sync_disabled');
    });

    it('updates existing event via PUT when connection is active', async () => {
      const mockDb = createMockDb();
      mockedGetActiveConnection.mockResolvedValueOnce({ id: 'conn-1' } as any);
      mockedGetValidCredential.mockResolvedValueOnce('ya29.mock_token');
      mockedFetchWithRetry.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 'slgtask1' }),
      } as any);

      const res = await syncTaskReminderToGoogleCalendar(mockDb, {
        brand: 'cogmap',
        tenantId: 'default',
        taskId: 'task-1',
        title: 'Follow-up',
        dueAt: '2026-10-20T10:00:00.000Z',
        leadId: 'lead-1',
      });

      expect(res.synced).toBe(true);
      expect(res.eventId).toBe(deriveCalendarEventId('task-1'));
    });

    it('falls back to POST create if PUT returns 404', async () => {
      const mockDb = createMockDb();
      mockedGetActiveConnection.mockResolvedValueOnce({ id: 'conn-1' } as any);
      mockedGetValidCredential.mockResolvedValueOnce('ya29.mock_token');
      // PUT -> 404
      mockedFetchWithRetry.mockResolvedValueOnce({
        ok: false,
        status: 404,
      } as any);
      // POST -> 200 OK
      mockedFetchWithRetry.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 'slgtask1' }),
      } as any);

      const res = await syncTaskReminderToGoogleCalendar(mockDb, {
        brand: 'cogmap',
        tenantId: 'default',
        taskId: 'task-1',
        title: 'Follow-up',
        dueAt: '2026-10-20T10:00:00.000Z',
        leadId: 'lead-1',
      });

      expect(res.synced).toBe(true);
      expect(mockedFetchWithRetry).toHaveBeenCalledTimes(2);
    });

    it('fails safely without throwing when network or API throws', async () => {
      const mockDb = createMockDb();
      mockedGetActiveConnection.mockResolvedValueOnce({ id: 'conn-1' } as any);
      mockedGetValidCredential.mockRejectedValueOnce(new Error('Revoked Google grant'));

      const res = await syncTaskReminderToGoogleCalendar(mockDb, {
        brand: 'cogmap',
        tenantId: 'default',
        taskId: 'task-1',
        title: 'Follow-up',
        dueAt: '2026-10-20T10:00:00.000Z',
        leadId: 'lead-1',
      });

      expect(res.synced).toBe(false);
      expect(res.reason).toContain('credential_error');
    });
  });

  describe('deleteCalendarTaskReminder', () => {
    function createMockDb() {
      return { collection: () => ({ findOne: async () => null }) } as any;
    }

    it('calls DELETE and returns deleted: true on 204 or 404', async () => {
      const mockDb = createMockDb();
      mockedGetActiveConnection.mockResolvedValueOnce({ id: 'conn-1' } as any);
      mockedGetValidCredential.mockResolvedValueOnce('ya29.mock_token');
      mockedFetchWithRetry.mockResolvedValueOnce({
        ok: true,
        status: 204,
      } as any);

      const res = await deleteCalendarTaskReminder(mockDb, {
        brand: 'cogmap',
        tenantId: 'default',
        taskId: 'task-1',
      });

      expect(res.deleted).toBe(true);
    });

    it('treats 404 Not Found as success (already deleted)', async () => {
      const mockDb = createMockDb();
      mockedGetActiveConnection.mockResolvedValueOnce({ id: 'conn-1' } as any);
      mockedGetValidCredential.mockResolvedValueOnce('ya29.mock_token');
      mockedFetchWithRetry.mockResolvedValueOnce({
        ok: false,
        status: 404,
      } as any);

      const res = await deleteCalendarTaskReminder(mockDb, {
        brand: 'cogmap',
        tenantId: 'default',
        taskId: 'task-1',
      });

      expect(res.deleted).toBe(true);
    });

    it('uses identical deterministic event ID for followup-{leadId} across snooze upsert and action-done delete (Issue 274)', () => {
      const leadId = '65f1a2b3c4d5e6f7a8b9c0d1';
      const snoozeEventId = deriveCalendarEventId(`followup-${leadId}`);
      const actionDoneEventId = deriveCalendarEventId(`followup-${leadId}`);
      expect(snoozeEventId).toBe(actionDoneEventId);
      expect(/^[a-v0-9]+$/.test(snoozeEventId)).toBe(true);
      expect(snoozeEventId.includes(leadId)).toBe(true);
    });
  });
});
