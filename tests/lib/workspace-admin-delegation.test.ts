import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { ObjectId } from 'mongodb';

const verifyIdTokenMock = vi.fn();
const getUserAccessMock = vi.fn();
const isMongoConfiguredMock = vi.fn();
const findOneReviewMock = vi.fn();
const findAndUpdateReviewMock = vi.fn();
const findReviewsArrayMock = vi.fn();
const findPromptsOneMock = vi.fn();
const updatePromptsOneMock = vi.fn();
const findTogglesArrayMock = vi.fn();
const updateTogglesOneMock = vi.fn();

const fakeDb = {
  collection: (name: string) => {
    if (name === 'duplicate_reviews') {
      return {
        find: () => ({
          sort: () => ({
            toArray: () => findReviewsArrayMock(),
          }),
        }),
        findOne: (...args: any[]) => findOneReviewMock(...args),
        findOneAndUpdate: (...args: any[]) => findAndUpdateReviewMock(...args),
      };
    }
    if (name === 'prompts') {
      return {
        findOne: (...args: any[]) => findPromptsOneMock(...args),
        updateOne: (...args: any[]) => updatePromptsOneMock(...args),
      };
    }
    if (name === 'tenant_operations') {
      return {
        find: () => ({
          toArray: () => findTogglesArrayMock(),
        }),
        updateOne: (...args: any[]) => updateTogglesOneMock(...args),
      };
    }
    return {
      find: () => ({ toArray: async () => [] }),
      findOne: async () => null,
    };
  },
};

vi.mock('@/lib/sso', () => ({
  verifyIdToken: (...args: any[]) => verifyIdTokenMock(...args),
}));

vi.mock('@/lib/mongodb', () => ({
  default: Promise.resolve({ db: () => fakeDb }),
  getClientPromise: () => Promise.resolve({ db: () => fakeDb }),
  isMongoConfigured: () => isMongoConfiguredMock(),
}));

vi.mock('@/lib/sso-access', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/sso-access')>();
  return {
    ...actual,
    getUserAccess: (...args: any[]) => getUserAccessMock(...args),
  };
});

function reqWithCookie(url: string, cookieValue: string | null, init?: ConstructorParameters<typeof NextRequest>[1]) {
  const headers = new Headers(init?.headers);
  if (cookieValue) {
    headers.set('cookie', `sso_id_token=${cookieValue}`);
  }
  return new NextRequest(`http://localhost${url}`, { ...init, headers });
}

describe('Workspace admin delegation (issue 356)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SSO_SUPER_ADMIN_EMAILS = 'platform-owner@haho.ai';
    process.env.MONGODB_URI = 'mongodb://localhost:27017/slg_test';
    isMongoConfiguredMock.mockReturnValue(true);
    findReviewsArrayMock.mockResolvedValue([]);
    findPromptsOneMock.mockResolvedValue({
      brand: 'seyu',
      tenantId: 'seyu',
      type: 'discovery',
      content: 'Find sports clubs',
    });
    updatePromptsOneMock.mockResolvedValue({ acknowledged: true });
    findTogglesArrayMock.mockResolvedValue([{ operation: 'discovery', enabled: false }]);
    updateTogglesOneMock.mockResolvedValue({ acknowledged: true });
  });

  describe('requireBrandAdminSession', () => {
    it('returns 401 before invoking lazy brand resolver when unauthenticated', async () => {
      const { requireBrandAdminSession } = await import('@/lib/session');
      const resolver = vi.fn();
      const res = await requireBrandAdminSession(reqWithCookie('/api/duplicate-reviews', null), resolver);
      expect('status' in res && res.status).toBe(401);
      expect(resolver).not.toHaveBeenCalled();
    });

    it('permits a workspace admin for their own brand and rejects them for another brand', async () => {
      const { requireBrandAdminSession } = await import('@/lib/session');
      verifyIdTokenMock.mockResolvedValue({ sub: 'user-seyu-admin', email: 'admin@client.example.com' });
      getUserAccessMock.mockResolvedValue({
        ssoUserId: 'user-seyu-admin',
        orgAccess: { seyu: 'admin', cogmap: 'user' },
      });

      const allowed = await requireBrandAdminSession(reqWithCookie('/api/prompts', 'tok'), 'seyu');
      expect('sub' in allowed && allowed.sub).toBe('user-seyu-admin');

      const deniedOther = await requireBrandAdminSession(reqWithCookie('/api/prompts', 'tok'), 'cogmap');
      expect('status' in deniedOther && deniedOther.status).toBe(403);

      const deniedUnassigned = await requireBrandAdminSession(reqWithCookie('/api/prompts', 'tok'), 'dvsc');
      expect('status' in deniedUnassigned && deniedUnassigned.status).toBe(403);
    });

    it('permits a super admin across every workspace regardless of orgAccess', async () => {
      const { requireBrandAdminSession } = await import('@/lib/session');
      verifyIdTokenMock.mockResolvedValue({ sub: 'owner-1', email: 'platform-owner@haho.ai' });

      const allowed = await requireBrandAdminSession(reqWithCookie('/api/prompts', 'tok'), 'dvsc');
      expect('sub' in allowed && allowed.sub).toBe('owner-1');
      expect(getUserAccessMock).not.toHaveBeenCalled();
    });
  });

  describe('/api/prompts and /api/admin/toggle tenant isolation', () => {
    it('allows brand admin to read prompts and toggles for their own brand and blocks cross-tenant tenantId', async () => {
      const promptsRoute = await import('@/app/api/prompts/route');
      const toggleRoute = await import('@/app/api/admin/toggle/route');
      verifyIdTokenMock.mockResolvedValue({ sub: 'user-seyu-admin', email: 'admin@client.example.com' });
      getUserAccessMock.mockResolvedValue({
        ssoUserId: 'user-seyu-admin',
        orgAccess: { seyu: 'admin' },
      });

      const okPrompt = await promptsRoute.GET(
        reqWithCookie('/api/prompts?brand=seyu&tenantId=seyu&type=discovery', 'tok'),
      );
      expect(okPrompt.status).toBe(200);

      const crossTenantPrompt = await promptsRoute.GET(
        reqWithCookie('/api/prompts?brand=seyu&tenantId=cogmap&type=discovery', 'tok'),
      );
      expect(crossTenantPrompt.status).toBe(403);

      const otherBrandPrompt = await promptsRoute.GET(
        reqWithCookie('/api/prompts?brand=cogmap&tenantId=cogmap&type=discovery', 'tok'),
      );
      expect(otherBrandPrompt.status).toBe(403);

      const okToggle = await toggleRoute.GET(
        reqWithCookie('/api/admin/toggle?brand=seyu&tenantId=seyu', 'tok'),
      );
      expect(okToggle.status).toBe(200);
      const toggleJson = await okToggle.json();
      expect(toggleJson.toggles.discovery).toBe(false);

      const crossTenantToggle = await toggleRoute.PUT(
        reqWithCookie('/api/admin/toggle', 'tok', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ brand: 'seyu', tenantId: 'cogmap', operation: 'discovery', enabled: true }),
        }),
      );
      expect(crossTenantToggle.status).toBe(403);
    });
  });

  describe('/api/duplicate-reviews workspace authorization', () => {
    it('authorizes PATCH against the stored review brand and blocks cross-workspace edits', async () => {
      const reviewsRoute = await import('@/app/api/duplicate-reviews/route');
      const seyuReviewId = new ObjectId().toString();
      const cogmapReviewId = new ObjectId().toString();

      verifyIdTokenMock.mockResolvedValue({ sub: 'user-seyu-admin', email: 'admin@client.example.com' });
      getUserAccessMock.mockResolvedValue({
        ssoUserId: 'user-seyu-admin',
        orgAccess: { seyu: 'admin' },
      });

      findOneReviewMock.mockResolvedValueOnce({ _id: new ObjectId(cogmapReviewId), brand: 'cogmap' });
      const forbiddenPatch = await reviewsRoute.PATCH(
        reqWithCookie('/api/duplicate-reviews', 'tok', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reviewId: cogmapReviewId, status: 'confirmed' }),
        }),
      );
      expect(forbiddenPatch.status).toBe(403);

      findOneReviewMock.mockResolvedValueOnce({ _id: new ObjectId(seyuReviewId), brand: 'seyu' });
      findAndUpdateReviewMock.mockResolvedValueOnce({
        _id: new ObjectId(seyuReviewId),
        status: 'confirmed',
      });
      const allowedPatch = await reviewsRoute.PATCH(
        reqWithCookie('/api/duplicate-reviews', 'tok', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reviewId: seyuReviewId, status: 'confirmed' }),
        }),
      );
      expect(allowedPatch.status).toBe(200);
    });
  });
});
