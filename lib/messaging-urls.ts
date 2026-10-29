/**
 * Normalizes a phone string into digits for WhatsApp and iMessage URL schemes.
 * E.g.: "+27 72 188 5925" -> "27721885925"
 * E.g.: "00212 677 885 017" -> "212677885017"
 */
export function normalizePhoneForMessaging(phone: string): string {
  if (!phone || typeof phone !== 'string') return '';
  let digits = phone.replace(/[^\d+]/g, '');
  if (digits.startsWith('00')) {
    digits = digits.slice(2);
  } else if (digits.startsWith('+')) {
    digits = digits.slice(1);
  }
  return digits.replace(/\D/g, '');
}

/**
 * Builds standard WhatsApp Click-to-Chat URL.
 * https://faq.whatsapp.com/5913398998672934
 */
export function buildWhatsAppUrl(phone: string, text?: string): string {
  const digits = normalizePhoneForMessaging(phone);
  if (!digits) return '';
  const base = `https://wa.me/${digits}`;
  if (text && text.trim()) {
    return `${base}?text=${encodeURIComponent(text.trim())}`;
  }
  return base;
}

/**
 * Builds standard iMessage / SMS URL scheme.
 * Works natively on macOS, iOS, and mobile browsers.
 */
export function buildIMessageUrl(phone: string, body?: string): string {
  const digits = normalizePhoneForMessaging(phone);
  if (!digits) return '';
  const base = `sms:${digits}`;
  if (body && body.trim()) {
    // Both macOS/iOS handle `&body=` or `?body=`
    return `${base}&body=${encodeURIComponent(body.trim())}`;
  }
  return base;
}
