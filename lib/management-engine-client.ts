/**
 * HTTP and direct client for patching listings back to the `management` content engine.
 * Specifically used for Padel Africa directory integration: when CRM reps or agents
 * qualify contact numbers, verified websites, or details, this client pushes the patch
 * to `management`'s `POST /api/ingest` endpoint.
 */

export interface ListingPatchPayload {
  name?: string;
  phone?: string;
  website?: string;
  description?: string;
  venue?: {
    name?: string;
    address?: {
      line1?: string;
      locality?: string;
      region?: string;
      countryCode?: string;
    };
  };
  [key: string]: unknown;
}

export interface ManagementIngestResponse {
  ok: boolean;
  outcome?: string;
  listingId?: string;
  error?: string;
  details?: unknown;
}

export interface ManagementClientConfig {
  baseUrl?: string;
  apiKey?: string;
  fetchFn?: typeof fetch;
}

export class ManagementEngineClient {
  private baseUrl: string;
  private apiKey: string;
  private fetchFn: typeof fetch;

  constructor(config: ManagementClientConfig = {}) {
    this.baseUrl = (
      config.baseUrl ||
      process.env.MANAGEMENT_API_URL ||
      'https://padel-africa.doneisbetter.com'
    ).replace(/\/+$/, '');
    this.apiKey = config.apiKey || process.env.MANAGEMENT_INGEST_KEY || '';
    this.fetchFn = config.fetchFn || fetch;
  }

  /**
   * Patches an existing listing in `management` via `POST /api/ingest`.
   * Enforces that `id` and `patch` are provided.
   */
  async patchListing(
    listingId: string,
    patch: ListingPatchPayload,
    options?: { reason?: string }
  ): Promise<ManagementIngestResponse> {
    if (!listingId || !listingId.trim()) {
      return { ok: false, error: 'listingId is required' };
    }

    if (!patch || typeof patch !== 'object' || Object.keys(patch).length === 0) {
      return { ok: false, error: 'patch object cannot be empty' };
    }

    const payload = {
      id: listingId.trim(),
      sourcePool: 'ingest',
      patch,
      ...(options?.reason ? { reason: options.reason } : {}),
    };

    try {
      const res = await this.fetchFn(`${this.baseUrl}/api/ingest`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey ? { 'x-api-key': this.apiKey } : {}),
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        return {
          ok: false,
          error: data?.error || `HTTP ${res.status}: ${res.statusText}`,
          details: data,
        };
      }

      return {
        ok: true,
        outcome: data?.outcome || 'accepted',
        listingId: listingId.trim(),
        details: data,
      };
    } catch (err: any) {
      return {
        ok: false,
        error: `Network or fetch failure: ${err?.message || String(err)}`,
      };
    }
  }
}
