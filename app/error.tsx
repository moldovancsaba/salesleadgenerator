'use client';

import { useEffect } from 'react';
import { Container, Title, Text, Button, Stack } from '@mantine/core';

// Issue #101: this app had no error boundary anywhere, at any level. An
// uncaught render error (the sales-settings crash this issue fixes, or any
// future one) took the whole page down to a blank/broken screen with zero
// recovery path — reported by a real user as "This page couldn't load,"
// indistinguishable from a genuine network failure. `reset()` re-renders the
// failed segment without a full page reload where that's enough to recover
// (e.g. a transient fetch failure); "Reload page" falls back to a hard
// reload for anything reset() can't clear.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[app/error.tsx] Uncaught render error:', error);
  }, [error]);

  return (
    <Container size="xs" py="xl">
      <Stack gap="md" align="center">
        <Title order={2}>Something went wrong</Title>
        <Text c="dimmed" ta="center">
          This page hit an unexpected error. Your data is safe — this is a display problem, not a data-loss one.
        </Text>
        <Button onClick={() => reset()}>Try again</Button>
        <Button variant="subtle" onClick={() => window.location.reload()}>
          Reload page
        </Button>
      </Stack>
    </Container>
  );
}
