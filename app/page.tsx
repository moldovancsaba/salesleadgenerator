import { Container, Text, Button, Stack, Title } from '@mantine/core';
import { InfoCard } from '@doneisbetter/gds-admin/client';

export default function LandingPage() {
  return (
    <Container size="xs" py="xl">
      <Stack gap="md" align="center">
        <Title order={1}>AI Sales Lead Collector</Title>
        <Text c="dimmed">Contact for quote</Text>
        <Button component="a" href="mailto:salesleadgenerator@haho.ai" size="md">salesleadgenerator@haho.ai</Button>
        <InfoCard title="Status" value="Available" description="Contact for quote" />
      </Stack>
    </Container>
  );
}
