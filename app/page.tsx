export default function LandingPage() {
  return (
    <div style={{
      minHeight: '100dvh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'var(--mantine-color-gray-0)',
      padding: '1rem',
    }}>
      <div style={{
        maxWidth: 520,
        textAlign: 'center',
        padding: '1.5rem',
      }}>
        <h1 style={{
          fontSize: '1.5rem',
          fontWeight: 700,
          marginBottom: '1rem',
          color: 'var(--mantine-color-gray-9)',
        }}>
          AI Sales Lead Collector
        </h1>
        <p style={{
          fontSize: '1.125rem',
          color: 'var(--mantine-color-gray-7)',
          marginBottom: '1rem',
          lineHeight: 1.625,
        }}>
          Contact for quote
        </p>
        <a
          href="mailto:salesleadgenerator@haho.ai"
          style={{
            display: 'inline-block',
            padding: '0.5rem 1rem',
            borderRadius: '0.5rem',
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
