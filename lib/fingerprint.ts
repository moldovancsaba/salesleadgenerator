import crypto from 'crypto';

export function buildFingerprint(name: string, url: string, region: string): string {
  const data = `${(url || '').trim().toLowerCase()}|${(name || '').trim().toLowerCase()}|${(region || '').toUpperCase()}`;
  return crypto.createHash('sha1').update(data).digest('hex');
}
