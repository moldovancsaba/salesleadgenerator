import type { Db, ObjectId } from 'mongodb';
import { scanTechStack } from '../../lib/tech-stack-scan';

// Runs the guarded scan (lib/tech-stack-scan.ts — never throws, every
// failure mode resolves to a status) and writes the result back. Callers
// (POST /api/leads, the RESCAN_TECH action) invoke this with `void`,
// fire-and-forget, strictly after their own insert/response is already
// built — a scan issue can never block or fail lead creation. The whole
// body is still wrapped in try/catch: the Mongo write-back itself can
// reject even though the scan never does.
export async function scanLeadTechStackAsync(
  db: Db,
  collectionName: string,
  leadId: ObjectId,
  url: string
): Promise<void> {
  try {
    const result = await scanTechStack(url);
    await db.collection(collectionName).updateOne(
      { _id: leadId },
      {
        $set: {
          techSignals: result.signals,
          techSignalsScannedAt: result.scannedAt,
          techSignalsScanStatus: result.status,
          updatedAt: new Date(),
        },
      }
    );
  } catch (error) {
    console.error('[tech-scan] write-back failed', { leadId: leadId.toString(), error });
  }
}
