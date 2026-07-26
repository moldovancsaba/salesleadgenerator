import { Container, Text, Stack, Title } from '@mantine/core';

export const metadata = { title: 'Access Denied' };

const REASON_MESSAGES: Record<string, string> = {
  access_denied: 'You declined to sign in. Reload the page if this was a mistake.',
  unauthorized_client: 'This application is not authorized with the SSO provider.',
};

export default async function AccessDeniedPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;
  const message = (reason && REASON_MESSAGES[reason]) || 'Your access to this app has been revoked or denied by an SSO administrator.';

  return (
    <Container size="xs" py="xl">
      <Stack gap="md" align="center">
        <Title order={2}>Access Denied</Title>
        <Text c="dimmed" ta="center">{message}</Text>
      </Stack>
    </Container>
  );
}
