import { Container, Text, Stack, Title } from '@mantine/core';

export const metadata = { title: 'Welcome' };

// Issue #103's follow-up: shown for two distinct gates that read the same
// way to the person hitting them — DoneIsBetter's own app-level
// permissionStatus === 'pending' (their SSO admin hasn't approved this app
// for them yet), and this app's own zero-organization-access state (SSO
// approved, but no one has assigned them to CogMap or Seyu yet). Both mean
// "you're signed in, nothing to do but wait" from the user's side, so one
// warm, simple message covers both rather than two pages a first-time user
// would have no way to tell apart anyway.
export default function AccessPendingPage() {
  return (
    <Container size="xs" py="xl">
      <Stack gap="md" align="center">
        <Title order={2}>Welcome!</Title>
        <Text c="dimmed" ta="center">
          You&apos;re successfully signed in. We&apos;ll be in touch soon once you have access to your organization.
        </Text>
      </Stack>
    </Container>
  );
}
