import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import type { Db } from 'mongodb';
import { ObjectId } from 'mongodb';
import { startTestMongo, stopTestMongo } from './helpers/mongo-test-server';
import { buildApiRequest } from './helpers/api-request';
import { ACTIVITY_LOG_COLLECTION } from '../../app/lib/activity-log-store';

let mongod: MongoMemoryServer;
let database: Db;
let completeStepPOST: typeof import('../../app/api/leads/[id]/cadence/complete-step/route').POST;
let tickGET: typeof import('../../app/api/admin/cadence-tick/route').GET;
let suppressRecipient: typeof import('../../lib/suppression').suppressRecipient;
let dispatchOutreachEmail: typeof import('../../lib/outreach-send').dispatchOutreachEmail;

beforeAll(async () => {
  mongod = await startTestMongo();
  const { MongoClient } = await import('mongodb');
  const client = new MongoClient(process.env.MONGODB_URI!);
  await client.connect();
  database = client.db();

  const stepMod = await import('../../app/api/leads/[id]/cadence/complete-step/route');
  completeStepPOST = stepMod.POST;
  const tickMod = await import('../../app/api/admin/cadence-tick/route');
  tickGET = tickMod.GET;
  const suppMod = await import('../../lib/suppression');
  suppressRecipient = suppMod.suppressRecipient;
  const sendMod = await import('../../lib/outreach-send');
  dispatchOutreachEmail = sendMod.dispatchOutreachEmail;
}, 60000);

afterAll(async () => {
  await stopTestMongo(mongod);
});

function req(url: string, init?: Parameters<typeof buildApiRequest>[1]) {
  return buildApiRequest(url, init);
}

describe('CRM Invariants Integration Tests', () => {
  const brand = 'cogmap';
  const tenantId = 'default';

  describe('Invariant 1: Suppression registry enforcement', () => {
    it('aborts dispatch when recipient email or domain is suppressed', async () => {
      await suppressRecipient(database, {
        brand,
        tenantId,
        target: 'suppressed-user@example.com',
        reason: 'unsubscribed',
      });
      await suppressRecipient(database, {
        brand,
        tenantId,
        target: 'blocked-domain.com',
        reason: 'bounced',
      });

      const leadDirect = {
        _id: new ObjectId().toString(),
        contacts: [{ name: 'Suppressed User', email: 'suppressed-user@example.com', isDecisionMaker: true }],
      };
      const template = {
        id: 't1',
        name: 'Test',
        channel: 'email' as const,
        industry: '',
        subject: 'Hello',
        body: 'Testing',
        variables: [],
      };

      const resultDirect = await dispatchOutreachEmail(
        database,
        leadDirect as any,
        template,
        { brand, tenantId },
        { kind: 'cadence', cadenceId: 'c1', stepIndex: 0 }
      );

      expect(resultDirect.sent).toBe(false);
      expect(resultDirect.reason).toContain('SEND_CANCELLED_SUPPRESSED');
      expect(resultDirect.reason).toContain('unsubscribed');

      const logDirect = await database.collection('outreach_logs').findOne({ _id: new ObjectId(resultDirect.outreachLogId) });
      expect(logDirect?.sendAttempted).toBe(false);
      expect(logDirect?.routingAllowed).toBe(false);
      expect(logDirect?.to).toBe('suppressed-user@example.com');

      // Test domain suppression
      const leadDomain = {
        _id: new ObjectId().toString(),
        contacts: [{ name: 'Domain User', email: 'anyone@blocked-domain.com', isDecisionMaker: true }],
      };
      const resultDomain = await dispatchOutreachEmail(
        database,
        leadDomain as any,
        template,
        { brand, tenantId },
        { kind: 'cadence', cadenceId: 'c1', stepIndex: 0 }
      );
      expect(resultDomain.sent).toBe(false);
      expect(resultDomain.reason).toContain('SEND_CANCELLED_SUPPRESSED');
      expect(resultDomain.reason).toContain('bounced');
    });
  });

  describe('Invariant 2: Inbound replies cancel automated cadence outreach', () => {
    it('aborts cadence send if contact has an inbound reply in activityLog', async () => {
      const leadId = new ObjectId().toString();

      // Record an inbound reply in activityLog
      await database.collection(ACTIVITY_LOG_COLLECTION).insertOne({
        leadId,
        tenantId,
        brand,
        type: 'email-inbound',
        direction: 'inbound',
        subject: 'Re: Inquiry',
        bodyExcerpt: 'Thanks for reaching out',
        source: 'inbound-webhook',
        createdAt: new Date(),
      });

      const lead = {
        _id: leadId,
        contacts: [{ name: 'Replied User', email: 'replied@example.com', isDecisionMaker: true }],
      };
      const template = {
        id: 't2',
        name: 'Follow up',
        channel: 'email' as const,
        industry: '',
        subject: 'Follow up',
        body: 'Just checking in',
        variables: [],
      };

      const result = await dispatchOutreachEmail(
        database,
        lead as any,
        template,
        { brand, tenantId },
        { kind: 'cadence', cadenceId: 'c2', stepIndex: 1 }
      );

      expect(result.sent).toBe(false);
      expect(result.reason).toBe('SEND_CANCELLED_REPLIED: contact has replied');

      const log = await database.collection('outreach_logs').findOne({ _id: new ObjectId(result.outreachLogId) });
      expect(log?.sendAttempted).toBe(false);
      expect(log?.routingAllowed).toBe(false);
    });
  });

  describe('Invariant 3: Manual task completion gating', () => {
    it('pauses cadence at manual step and advances only upon explicit rep completion', async () => {
      const cadenceInsert = await database.collection('cadences').insertOne({
        tenantId,
        brand,
        name: 'Gated Cadence',
        enabled: true,
        steps: [
          { id: 's1', channel: 'general', waitDaysAfterPrevious: 0, reminderNote: 'Research account prior to touch' },
          { id: 's2', channel: 'call', waitDaysAfterPrevious: 2, reminderNote: 'Call prospect' },
        ],
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const cadenceId = cadenceInsert.insertedId.toString();

      const leadInsert = await database.collection('leads').insertOne({
        entity_name: 'Completion Gating Corp',
        tenantId,
        kanbanColumn: 'DISCOVERED',
        activeCadence: {
          cadenceId,
          currentStepIndex: 0,
          stepDueAt: new Date(Date.now() - 10000).toISOString(),
          enrolledAt: new Date(Date.now() - 10000).toISOString(),
        },
      });
      const leadId = leadInsert.insertedId.toString();

      // Run cadence tick
      const tickRes = await tickGET(req('/api/admin/cadence-tick'));
      const tickBody = await tickRes.json();
      expect(tickBody.remindersSet).toBe(1);

      // Verify lead is waiting for task and has NOT advanced
      const leadAfterTick = await database.collection('leads').findOne({ _id: leadInsert.insertedId });
      expect(leadAfterTick?.activeCadence?.waitingForTask).toBe(true);
      expect(leadAfterTick?.activeCadence?.currentStepIndex).toBe(0);
      expect(leadAfterTick?.activeCadence?.status).toBe('waiting_task');
      expect(leadAfterTick?.nextActionNote).toBe('Research account prior to touch');

      // Subsequent tick run MUST NOT advance or auto-complete the task
      const secondTickRes = await tickGET(req('/api/admin/cadence-tick'));
      const secondTickBody = await secondTickRes.json();
      expect(secondTickBody.processed).toBe(0);

      const leadStillWaiting = await database.collection('leads').findOne({ _id: leadInsert.insertedId });
      expect(leadStillWaiting?.activeCadence?.waitingForTask).toBe(true);
      expect(leadStillWaiting?.activeCadence?.currentStepIndex).toBe(0);

      // Rep completes the task via POST /api/leads/[id]/cadence/complete-step
      const completeRes = await completeStepPOST(
        req(`/api/leads/${leadId}/cadence/complete-step?brand=${brand}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ note: 'Finished company research on LinkedIn and Crunchbase' }),
        }),
        { params: Promise.resolve({ id: leadId }) }
      );

      const completeBody = await completeRes.json();
      expect(completeRes.status).toBe(200);
      expect(completeBody.ok).toBe(true);
      expect(completeBody.activeCadence?.waitingForTask).toBe(false);
      expect(completeBody.activeCadence?.currentStepIndex).toBe(1);
      expect(completeBody.activeCadence?.taskCompletedAt).toBeTruthy();

      // Check lead document state in DB
      const leadAfterComplete = await database.collection('leads').findOne({ _id: leadInsert.insertedId });
      expect(leadAfterComplete?.nextActionDueAt).toBeNull();
      expect(leadAfterComplete?.nextActionNote).toBeNull();
      expect(leadAfterComplete?.activeCadence?.currentStepIndex).toBe(1);
      expect(leadAfterComplete?.activeCadence?.waitingForTask).toBe(false);

      // Check activity log audit entry
      const activity = await database.collection(ACTIVITY_LOG_COLLECTION).findOne({
        leadId,
        source: 'manual',
      });
      expect(activity).not.toBeNull();
      expect(activity?.bodyExcerpt).toBe('Finished company research on LinkedIn and Crunchbase');
    });
  });
});
