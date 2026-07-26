'use client';

import { Container, Text, Button, Stack, Title, Divider } from '@mantine/core';
import { IconLogin } from '@tabler/icons-react';
import { InfoCard } from '@sovereignsquad/gds-admin/client';
import { useAuth } from './components/AuthProvider';

// Issue #103 follow-up: this was a purely static Server Component until
// now — the sign-in prompt below only makes sense for an anonymous
// visitor, so it needs useAuth() (Client Component only) to know whether
// to show it at all. Deliberately doesn't show anything extra once
// `user` is set — that would be new behavior no one asked for; a logged-
// in visitor still sees this same marketing content, just without a
// redundant "Sign in" prompt.
export default function LandingPage() {
  const { user, loading, login } = useAuth();

  return (
    <Container size="xs" py="xl">
      <Stack gap="md" align="center">
        <Title order={1}>AI Sales Lead Collector</Title>
        <Text c="dimmed">Contact for quote</Text>
        <Button component="a" href="mailto:salesleadgenerator@haho.ai" size="md">salesleadgenerator@haho.ai</Button>
        <InfoCard title="Status" value="Available" description="Contact for quote" />

        {!loading && !user && (
          <>
            <Divider w="100%" my="xs" />
            <Text size="sm" c="dimmed">Already have an account?</Text>
            <Button leftSection={<IconLogin size={18} />} variant="light" onClick={login}>
              Sign in
            </Button>
          </>
        )}
      </Stack>
    </Container>
  );
}
