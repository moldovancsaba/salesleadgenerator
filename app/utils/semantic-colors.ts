import { iceTone, qualityTone, regionTone } from '../theme/semantic';

export function semanticToneToMantineColor(tone: string): string {
  const map: Record<string, string> = {
    ingress: 'blue',
    synthesis: 'indigo',
    tactical: 'green',
    strategy: 'orange',
    review: 'teal',
    checklist: 'gray',
    neutral: 'gray',
  };
  return map[tone] || 'gray';
}

export { iceTone, qualityTone, regionTone };
