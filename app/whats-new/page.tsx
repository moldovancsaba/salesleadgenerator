import { redirect } from 'next/navigation';
import { getAllBrandConfigs } from '@/app/lib/brand';

export default async function WhatsNewRedirectPage() {
  const configs = await getAllBrandConfigs();
  const defaultBrand = Object.keys(configs)[0] || 'cogmap';
  redirect(`/whats-new/${defaultBrand}`);
}
