import type { SemanticTone } from '../theme/semantic';

export function resolveModuleTone(tone: SemanticTone): string {
  return tone;
}

export function getModuleTheme(tone: string): {
  color: string;
  background: string;
  border: string;
} {
  const themeMap: Record<string, { color: string; background: string; border: string }> = {
    ingress: { color: 'var(--mantine-color-blue-6)', background: 'var(--mantine-color-blue-0)', border: 'var(--mantine-color-blue-2)' },
    synthesis: { color: 'var(--mantine-color-green-6)', background: 'var(--mantine-color-green-0)', border: 'var(--mantine-color-green-2)' },
    knowledge: { color: 'var(--mantine-color-orange-6)', background: 'var(--mantine-color-orange-0)', border: 'var(--mantine-color-orange-2)' },
    strategy: { color: 'var(--mantine-color-violet-6)', background: 'var(--mantine-color-violet-0)', border: 'var(--mantine-color-violet-2)' },
    checklist: { color: 'var(--mantine-color-teal-6)', background: 'var(--mantine-color-teal-0)', border: 'var(--mantine-color-teal-2)' },
    tactical: { color: 'var(--mantine-color-pink-6)', background: 'var(--mantine-color-pink-0)', border: 'var(--mantine-color-pink-2)' },
    review: { color: 'var(--mantine-color-red-6)', background: 'var(--mantine-color-red-0)', border: 'var(--mantine-color-red-2)' },
    neutral: { color: 'var(--mantine-color-gray-6)', background: 'var(--mantine-color-gray-0)', border: 'var(--mantine-color-gray-2)' },
  };
  return themeMap[tone] || themeMap.neutral;
}
