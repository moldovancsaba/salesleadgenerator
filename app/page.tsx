import { tokens } from './theme/tokens';

export default function LandingPage() {
  return (
    <div style={{
      minHeight: '100dvh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'var(--mantine-color-gray-0)',
      padding: tokens.spacing.lg,
    }}>
      <div style={{
        maxWidth: 520,
        textAlign: 'center',
        padding: tokens.spacing.xl,
      }}>
        <h1 style={{
          fontSize: tokens.typography['2xl'],
          fontWeight: 700,
          marginBottom: tokens.spacing.lg,
          color: 'var(--mantine-color-gray-9)',
        }}>
          AI Sales Lead Collector
        </h1>
        <p style={{
          fontSize: tokens.typography.lg,
          color: 'var(--mantine-color-gray-7)',
          marginBottom: tokens.spacing.lg,
          lineHeight: tokens.lineHeights.relaxed,
        }}>
          Contact for quote
        </p>
        <a
          href="mailto:salesleadgenerator@haho.ai"
          style={{
            display: 'inline-block',
            padding: `${tokens.spacing.sm} ${tokens.spacing.lg}`,
            borderRadius: tokens.radii.md,
            backgroundColor: 'var(--mantine-color-blue-6)',
            color: 'white',
            textDecoration: 'none',
            fontWeight: 600,
          }}
        >
          salesleadgenerator@haho.ai
        </a>
      </div>
    </div>
  );
}
