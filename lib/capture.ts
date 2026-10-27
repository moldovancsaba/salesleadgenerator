import { z } from 'zod';
import { BUYING_ROLES, type BuyingRole } from './contacts';

function looseString(max: number) {
  return z
    .string()
    .nullish()
    .transform((v) => {
      const trimmed = (v ?? '').trim();
      return trimmed.length === 0 ? undefined : trimmed.slice(0, max);
    });
}

function looseUrl(max: number) {
  return z
    .string()
    .nullish()
    .transform((v) => {
      const raw = (v ?? '').trim();
      if (raw.length === 0 || raw.length > max) return undefined;
      try {
        const parsed = new URL(raw);
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return undefined;
        return raw;
      } catch {
        return undefined;
      }
    });
}

export const capturePayloadSchema = z.object({
  brand: z.string().trim().toLowerCase().min(1).max(50),
  url: z.string().url().max(1000),
  name: looseString(200),
  headline: looseString(400),
  companyName: looseString(200),
  location: looseString(200),
  jobTitle: looseString(200),
  email: looseString(320),
  phone: looseString(60),
  websiteUrl: looseUrl(500),
  bio: looseString(8000),
  photoUrl: looseUrl(2000),
  notes: looseString(5000),
  buyingRole: z
    .string()
    .nullish()
    .transform((v) => {
      const normalized = (v ?? '').trim().toLowerCase();
      if ((BUYING_ROLES as readonly string[]).includes(normalized)) {
        return normalized as BuyingRole;
      }
      return 'champion' as BuyingRole;
    }),
});

export type CapturePayload = z.infer<typeof capturePayloadSchema>;

export function parseLinkedInLocation(rawLocation?: string): {
  city?: string;
  country?: string;
  region?: string;
} {
  if (!rawLocation) return {};
  const cleaned = rawLocation.replace(/[\u200b-\u200f\u2060\ufeff]/g, '').trim();
  if (!cleaned) return {};

  const parts = cleaned.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 1) {
    return { city: parts[0] };
  }
  if (parts.length === 2) {
    return { city: parts[0], country: parts[1] };
  }
  return {
    city: parts[0],
    region: parts[1],
    country: parts[parts.length - 1],
  };
}
