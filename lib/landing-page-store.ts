import { Db, ObjectId } from 'mongodb';
import clientPromise, { isMongoConfigured } from '@/lib/mongodb';
import {
  LandingPageRecord,
  DEFAULT_VEGAS_CAMPAIGN,
  THEME_PRESETS,
  normalizeBannerAspectRatio,
  normalizeScannerConfig,
  normalizeEventDetails,
} from './landing-page-schema';

export const LANDING_PAGES_COLLECTION = 'landing_pages';

export async function ensureLandingPagesIndexes(db: Db): Promise<void> {
  try {
    await db.collection(LANDING_PAGES_COLLECTION).createIndex(
      { brand: 1, slug: 1, tenantId: 1 },
      { unique: true }
    );
    await db.collection(LANDING_PAGES_COLLECTION).createIndex(
      { brand: 1, published: 1 }
    );
  } catch (err) {
    console.error('[landing-page-store] Failed to ensure indexes', err);
  }
}

export async function getLandingPagesForBrand(
  brand: string,
  tenantId: string = 'default'
): Promise<LandingPageRecord[]> {
  if (!isMongoConfigured()) {
    if (brand === 'vegas') {
      return [DEFAULT_VEGAS_CAMPAIGN];
    }
    return [];
  }

  const client = await clientPromise;
  const db = client.db();
  await ensureLandingPagesIndexes(db);

  const docs = await db
    .collection(LANDING_PAGES_COLLECTION)
    .find({
      brand,
      $or: [{ tenantId }, { tenantId: 'default' }, { tenantId: { $exists: false } }],
    })
    .sort({ createdAt: -1 })
    .toArray();

  if (docs.length === 0 && brand === 'vegas') {
    // Seed default Vegas campaign into DB so it can be customized immediately
    try {
      const { id: _idOmit, _id: _dbIdOmit, ...seededData } = DEFAULT_VEGAS_CAMPAIGN;
      const res = await db.collection(LANDING_PAGES_COLLECTION).insertOne(seededData as any);
      return [{ ...DEFAULT_VEGAS_CAMPAIGN, id: res.insertedId.toString(), _id: res.insertedId.toString() }];
    } catch {
      return [DEFAULT_VEGAS_CAMPAIGN];
    }
  }

  return docs.map((d) => ({
    id: d._id.toString(),
    _id: d._id.toString(),
    brand: d.brand,
    tenantId: d.tenantId || 'default',
    slug: d.slug,
    title: d.title,
    description: d.description,
    published: d.published !== false,
    blocks: d.blocks || {
      showHeroBanner: true,
      showHeroCopy: true,
      showBullets: true,
      showDigitalPasses: true,
      showCalendarInvite: true,
      showTermsModal: true,
      showFooterDisclaimer: true,
    },
    heroBannerUrl: d.heroBannerUrl,
    heroBannerAspectRatio: normalizeBannerAspectRatio(d.heroBannerAspectRatio),
    scanner: d.scanner ? normalizeScannerConfig(d.scanner) : undefined,
    event: normalizeEventDetails(d.event),
    heroHeadline: d.heroHeadline,
    heroSubheadline: d.heroSubheadline,
    bodyBullets: d.bodyBullets || [],
    ctaButtonText: d.ctaButtonText || 'Submit',
    fields: d.fields || [],
    design: d.design || THEME_PRESETS.dark_emerald,
    termsHtml: d.termsHtml,
    footerDisclaimer: d.footerDisclaimer,
    successTitle: d.successTitle,
    successMessage: d.successMessage,
    viewsCount: d.viewsCount || 0,
    submissionsCount: d.submissionsCount || 0,
    createdAt: d.createdAt instanceof Date ? d.createdAt.toISOString() : (d.createdAt || new Date().toISOString()),
    updatedAt: d.updatedAt instanceof Date ? d.updatedAt.toISOString() : (d.updatedAt || new Date().toISOString()),
  }));
}

export async function getLandingPageBySlug(
  brand: string,
  slug: string,
  tenantId: string = 'default'
): Promise<LandingPageRecord | null> {
  if (!isMongoConfigured()) {
    if (brand === 'vegas' && slug === 'grand-slam-of-darts') {
      return DEFAULT_VEGAS_CAMPAIGN;
    }
    return null;
  }

  const client = await clientPromise;
  const db = client.db();

  const doc = await db.collection(LANDING_PAGES_COLLECTION).findOne({
    brand,
    slug,
    $or: [{ tenantId }, { tenantId: 'default' }, { tenantId: { $exists: false } }],
  });

  if (!doc) {
    if (brand === 'vegas' && slug === 'grand-slam-of-darts') {
      return DEFAULT_VEGAS_CAMPAIGN;
    }
    return null;
  }

  return {
    id: doc._id.toString(),
    _id: doc._id.toString(),
    brand: doc.brand,
    tenantId: doc.tenantId || 'default',
    slug: doc.slug,
    title: doc.title,
    description: doc.description,
    published: doc.published !== false,
    blocks: doc.blocks || {
      showHeroBanner: true,
      showHeroCopy: true,
      showBullets: true,
      showDigitalPasses: true,
      showCalendarInvite: true,
      showTermsModal: true,
      showFooterDisclaimer: true,
    },
    heroBannerUrl: doc.heroBannerUrl,
    heroBannerAspectRatio: normalizeBannerAspectRatio(doc.heroBannerAspectRatio),
    scanner: doc.scanner ? normalizeScannerConfig(doc.scanner) : undefined,
    event: normalizeEventDetails(doc.event),
    heroHeadline: doc.heroHeadline,
    heroSubheadline: doc.heroSubheadline,
    bodyBullets: doc.bodyBullets || [],
    ctaButtonText: doc.ctaButtonText || 'Submit',
    fields: doc.fields || [],
    design: doc.design || THEME_PRESETS.dark_emerald,
    termsHtml: doc.termsHtml,
    footerDisclaimer: doc.footerDisclaimer,
    successTitle: doc.successTitle,
    successMessage: doc.successMessage,
    viewsCount: doc.viewsCount || 0,
    submissionsCount: doc.submissionsCount || 0,
    createdAt: doc.createdAt instanceof Date ? doc.createdAt.toISOString() : (doc.createdAt || new Date().toISOString()),
    updatedAt: doc.updatedAt instanceof Date ? doc.updatedAt.toISOString() : (doc.updatedAt || new Date().toISOString()),
  };
}

export async function incrementLandingPageView(
  brand: string,
  slug: string
): Promise<void> {
  if (!isMongoConfigured()) return;
  try {
    const client = await clientPromise;
    const db = client.db();
    await db.collection(LANDING_PAGES_COLLECTION).updateOne(
      { brand, slug },
      { $inc: { viewsCount: 1 } }
    );
  } catch {
    // Non-fatal
  }
}

export async function incrementLandingPageSubmission(
  brand: string,
  slug: string
): Promise<void> {
  if (!isMongoConfigured()) return;
  try {
    const client = await clientPromise;
    const db = client.db();
    await db.collection(LANDING_PAGES_COLLECTION).updateOne(
      { brand, slug },
      { $inc: { submissionsCount: 1 } }
    );
  } catch {
    // Non-fatal
  }
}

export async function saveLandingPage(
  record: Omit<LandingPageRecord, 'id' | '_id' | 'createdAt' | 'updatedAt'> & {
    id?: string;
  }
): Promise<LandingPageRecord> {
  if (!isMongoConfigured()) {
    throw new Error('Database not configured');
  }

  const client = await clientPromise;
  const db = client.db();
  await ensureLandingPagesIndexes(db);

  const now = new Date();
  const slug = record.slug.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '-').replace(/--+/g, '-');

  if (!slug) {
    throw new Error('Landing page slug is required');
  }

  const scannerToSave = record.scanner ? normalizeScannerConfig(record.scanner) : undefined;
  if (scannerToSave?.enabled && !scannerToSave.accessCode) {
    throw new Error('Set an access code to turn the check-in scanner on');
  }

  const docToSave = {
    brand: record.brand,
    tenantId: record.tenantId || 'default',
    slug,
    title: record.title.trim(),
    description: record.description?.trim() || '',
    published: record.published !== false,
    heroBannerUrl: record.heroBannerUrl?.trim() || '',
    heroBannerAspectRatio: normalizeBannerAspectRatio(record.heroBannerAspectRatio),
    ...(record.blocks ? { blocks: record.blocks } : {}),
    ...(record.scanner ? { scanner: scannerToSave } : {}),
    event: normalizeEventDetails(record.event),
    heroHeadline: record.heroHeadline?.trim() || '',
    heroSubheadline: record.heroSubheadline?.trim() || '',
    bodyBullets: Array.isArray(record.bodyBullets) ? record.bodyBullets.filter(Boolean) : [],
    ctaButtonText: record.ctaButtonText?.trim() || 'Submit',
    fields: Array.isArray(record.fields) ? record.fields : [],
    design: record.design || THEME_PRESETS.dark_emerald,
    termsHtml: record.termsHtml?.trim() || '',
    footerDisclaimer: record.footerDisclaimer?.trim() || '',
    successTitle: record.successTitle?.trim() || 'Thank You!',
    successMessage: record.successMessage?.trim() || 'We have received your submission.',
    updatedAt: now,
  };

  if (record.id && ObjectId.isValid(record.id)) {
    const filter = { _id: new ObjectId(record.id), brand: record.brand };
    await db.collection(LANDING_PAGES_COLLECTION).updateOne(filter, { $set: docToSave });
    return {
      ...docToSave,
      id: record.id,
      _id: record.id,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
  }

  // Create new
  const insertPayload = {
    ...docToSave,
    viewsCount: 0,
    submissionsCount: 0,
    createdAt: now,
  };

  const res = await db.collection(LANDING_PAGES_COLLECTION).insertOne(insertPayload);
  return {
    ...insertPayload,
    id: res.insertedId.toString(),
    _id: res.insertedId.toString(),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

export async function deleteLandingPage(
  id: string,
  brand: string
): Promise<boolean> {
  if (!isMongoConfigured() || !ObjectId.isValid(id)) return false;
  const client = await clientPromise;
  const db = client.db();
  const res = await db.collection(LANDING_PAGES_COLLECTION).deleteOne({
    _id: new ObjectId(id),
    brand,
  });
  return res.deletedCount > 0;
}
