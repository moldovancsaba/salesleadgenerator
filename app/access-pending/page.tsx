import { Container, Text, Stack, Title } from '@mantine/core';

export const metadata = { title: 'Access Pending' };

export default function AccessPendingPage() {
  return (
    <Container size="xs" py="xl">
      <Stack gap="md" align="center">
        <Title order={2}>Access Pending</Title>
        <Text c="dimmed" ta="center">
          Your sign-in was successful, but an SSO administrator hasn&apos;t approved your access to this app yet.
          You&apos;ll be able to sign in normally once approved.
        </Text>
      </Stack>
    </Container>
  );
}
