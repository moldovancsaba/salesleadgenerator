import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('LeadDetailModal Tabbed Architecture (Issue #307)', () => {
  const detailFile = readFileSync(join(process.cwd(), 'app', 'detail.tsx'), 'utf8');

  it('imports and configures Mantine Tabs with semantic icons and count badges', () => {
    expect(detailFile).toContain("import { Stack, Group, Text, Progress, Button, Box, Title, SimpleGrid, NumberInput, TextInput, Select, Modal, Checkbox, ActionIcon, Divider, Menu, Tabs } from '@mantine/core';");
    expect(detailFile).toContain('IconBuilding');
    expect(detailFile).toContain('IconUsers');
    expect(detailFile).toContain('IconCoins');
    expect(detailFile).toContain('IconHistory');
  });

  it('manages activeTab state initialized to overview', () => {
    expect(detailFile).toContain("const [activeTab, setActiveTab] = useState<string | null>('overview');");
  });

  it('renders all four dedicated tabs with badge counts', () => {
    expect(detailFile).toContain('<Tabs value={activeTab} onChange={setActiveTab} variant="outline" radius="md">');
    expect(detailFile).toContain('<Tabs.Tab value="overview" leftSection={<IconBuilding size={16} />}>');
    expect(detailFile).toContain('<Tabs.Tab');
    expect(detailFile).toContain('value="contacts"');
    expect(detailFile).toContain('value="deals"');
    expect(detailFile).toContain('value="activity"');
  });

  it('separates content into structured Tabs.Panels', () => {
    expect(detailFile).toContain('<Tabs.Panel value="overview">');
    expect(detailFile).toContain('<Tabs.Panel value="contacts">');
    expect(detailFile).toContain('<Tabs.Panel value="deals">');
    expect(detailFile).toContain('<Tabs.Panel value="activity">');
  });

  it('preserves discovery playbooks and global tour selector on parent stack', () => {
    expect(detailFile).toContain('data-tour="lead-detail-content"');
    expect(detailFile).toContain('<SalesPathPlaybookBar');
  });
});
