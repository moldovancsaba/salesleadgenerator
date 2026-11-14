'use client';

import { EVENT_PASS_COLORS } from '@/lib/theme/event-pass-colors';
import { useEffect, useState, useTransition } from 'react';
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
  Container,
  Divider,
  Drawer,
  Group,
  Loader,
  Paper,
  Radio,
  ScrollArea,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Tabs,
  Text,
  TextInput,
  Textarea,
  Title,
  Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconPlus,
  IconExternalLink,
  IconCopy,
  IconEdit,
  IconTrash,
  IconCheck,
  IconDeviceFloppy,
  IconEye,
  IconTemplate,
  IconAdjustments,
  IconForms,
  IconPalette,
  IconSparkles,
  IconArrowUp,
  IconArrowDown,
  IconComponents,
  IconWallet,
  IconQrcode,
} from '@tabler/icons-react';
import {
  LandingPageRecord,
  LandingFormFieldConfig,
  LandingPageDesignConfig,
  LandingPageBlocksConfig,
  LandingPageConfirmationEmailConfig,
  DEFAULT_BLOCKS_CONFIG,
  DEFAULT_SCANNER_CONFIG,
  SCANNER_TARGET_COLUMNS,
  SLG_LEAD_PROPERTIES,
  THEME_PRESETS,
  LeadPropertyKey,
  DEFAULT_VEGAS_CAMPAIGN,
} from '@/lib/landing-page-schema';
import { columnLabel } from '@/lib/hostess-scan';

export function LandingPagesClient({
  brand,
  brandLabel,
}: {
  brand: string;
  brandLabel: string;
}) {
  const [pages, setPages] = useState<LandingPageRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingPage, setEditingPage] = useState<LandingPageRecord | null>(null);
  const [activeTab, setActiveTab] = useState<string | null>('content');

  // Load pages
  const loadPages = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/landing-pages?brand=${encodeURIComponent(brand)}`);
      const data = await res.json();
      if (res.ok && Array.isArray(data.pages)) {
        setPages(data.pages);
      } else {
        setPages([]);
      }
    } catch {
      notifications.show({
        title: 'Error',
        message: 'Failed to load landing pages',
        color: 'red',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    const fetchPages = async () => {
      try {
        setLoading(true);
        const res = await fetch(`/api/landing-pages?brand=${encodeURIComponent(brand)}`);
        const data = await res.json();
        if (active) {
          if (res.ok && Array.isArray(data.pages)) {
            setPages(data.pages);
          } else {
            setPages([]);
          }
        }
      } catch {
        if (active) {
          notifications.show({
            title: 'Error',
            message: 'Failed to load landing pages',
            color: 'red',
          });
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };
    fetchPages();
    return () => {
      active = false;
    };
  }, [brand]);

  const handleOpenCreate = () => {
    const newPage: LandingPageRecord = {
      brand,
      tenantId: 'default',
      slug: `campaign-${Date.now().toString().slice(-4)}`,
      title: `${brandLabel} Inbound Lead Campaign`,
      description: `Official registration and lead collector for ${brandLabel}`,
      published: true,
      heroHeadline: `Discover ${brandLabel} Solutions`,
      heroSubheadline: 'Fill in your details below to connect with our team and receive priority access.',
      bodyBullets: ['Instant verification', 'Customized executive briefing'],
      ctaButtonText: 'Register Now',
      fields: [
        {
          id: `f_${Date.now()}_1`,
          leadProperty: 'contact_first_name',
          label: 'First Name',
          placeholder: 'e.g. Alex',
          type: 'text',
          required: true,
        },
        {
          id: `f_${Date.now()}_2`,
          leadProperty: 'contact_last_name',
          label: 'Last Name',
          placeholder: 'e.g. Morgan',
          type: 'text',
          required: false,
        },
        {
          id: `f_${Date.now()}_3`,
          leadProperty: 'contact_email',
          label: 'Work Email',
          placeholder: 'alex@company.com',
          type: 'email',
          required: true,
        },
        {
          id: `f_${Date.now()}_4`,
          leadProperty: 'entity_name',
          label: 'Company / Club Name',
          placeholder: 'e.g. Apex Sports',
          type: 'text',
          required: true,
        },
        {
          id: `f_${Date.now()}_5`,
          leadProperty: 'country',
          label: 'Country',
          type: 'select',
          required: true,
        },
      ],
      design: THEME_PRESETS.indigo_tech,
      successTitle: 'Thank You for Registering!',
      successMessage: 'Our sales team has received your inquiry and will reach out shortly.',
      viewsCount: 0,
      submissionsCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setEditingPage(newPage);
    setActiveTab('blocks');
    setEditorOpen(true);
  };

  const handleCreateFromTemplate = (templateType: 'event_pass' | 'lead_magnet') => {
    if (templateType === 'event_pass') {
      const template = JSON.parse(JSON.stringify(DEFAULT_VEGAS_CAMPAIGN)) as LandingPageRecord;
      delete template.id;
      delete template._id;
      template.brand = brand;
      template.slug = `vip-event-pass-${Date.now().toString().slice(-4)}`;
      template.title = `${brandLabel} VIP Event Pass & Entry`;
      template.heroHeadline = `Official ${brandLabel} VIP Event Pass Registration`;
      template.heroSubheadline = `Complete the registration form to receive your official digital pass, contact card, and fast-track entry pass.`;
      template.blocks = DEFAULT_BLOCKS_CONFIG;
      template.heroBannerUrl = '';
      template.heroBannerAspectRatio = undefined;
      template.bodyBullets = [];
      template.footerDisclaimer = '';
      template.termsHtml = '';
      template.scanner = { ...DEFAULT_SCANNER_CONFIG, enabled: true };
      template.event = undefined;
      template.confirmationEmail = undefined;
      setEditingPage(template);
      setActiveTab('blocks');
      setEditorOpen(true);
    } else {
      handleOpenCreate();
    }
  };

  const handleOpenEdit = (p: LandingPageRecord) => {
    setEditingPage(JSON.parse(JSON.stringify(p)));
    setActiveTab('blocks');
    setEditorOpen(true);
  };

  const handleDelete = async (id?: string) => {
    if (!id) return;
    if (!confirm('Are you sure you want to delete this landing page?')) return;
    try {
      const res = await fetch(`/api/landing-pages/${id}?brand=${encodeURIComponent(brand)}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete');
      notifications.show({
        title: 'Deleted',
        message: 'Landing page deleted successfully',
        color: 'green',
      });
      await loadPages();
    } catch (e: any) {
      notifications.show({
        title: 'Error',
        message: e.message || 'Could not delete page',
        color: 'red',
      });
    }
  };

  const handleSavePage = async () => {
    if (editingPage?.scanner?.enabled && !editingPage.scanner.accessCode?.trim()) {
      notifications.show({
        title: 'Access code needed',
        message: 'Set an access code in the Check-in scanner tab to turn the scanner on.',
        color: 'orange',
      });
      setActiveTab('checkin');
      return;
    }
    if (!editingPage) return;
    if (!editingPage.title.trim()) {
      notifications.show({ title: 'Validation', message: 'Page title is required', color: 'red' });
      return;
    }
    if (!editingPage.slug.trim()) {
      notifications.show({ title: 'Validation', message: 'Page URL slug is required', color: 'red' });
      return;
    }

    try {
      setSaving(true);
      const url = editingPage.id
        ? `/api/landing-pages/${editingPage.id}?brand=${encodeURIComponent(brand)}`
        : `/api/landing-pages?brand=${encodeURIComponent(brand)}`;
      const method = editingPage.id ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editingPage),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to save landing page');
      }

      notifications.show({
        title: 'Saved',
        message: 'Landing page published instantly to MongoDB without rebuild!',
        color: 'green',
      });

      setEditorOpen(false);
      await loadPages();
    } catch (err: any) {
      notifications.show({
        title: 'Error',
        message: err.message || 'Failed to save page',
        color: 'red',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleAddField = (propertyKey: LeadPropertyKey) => {
    if (!editingPage) return;
    const propMeta = SLG_LEAD_PROPERTIES.find((p) => p.key === propertyKey);
    const newField: LandingFormFieldConfig = {
      id: `f_${Date.now()}`,
      leadProperty: propertyKey,
      label: propMeta?.label || propertyKey,
      type: propMeta?.defaultType || 'text',
      required: propertyKey === 'contact_email' || propertyKey === 'contact_first_name',
      placeholder: `e.g. Enter ${propMeta?.label || propertyKey}`,
    };
    setEditingPage({
      ...editingPage,
      fields: [...editingPage.fields, newField],
    });
  };

  const handleRemoveField = (fieldId: string) => {
    if (!editingPage) return;
    setEditingPage({
      ...editingPage,
      fields: editingPage.fields.filter((f) => f.id !== fieldId),
    });
  };

  const handleMoveField = (index: number, direction: 'up' | 'down') => {
    if (!editingPage) return;
    const newFields = [...editingPage.fields];
    const targetIdx = direction === 'up' ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= newFields.length) return;
    const temp = newFields[index];
    newFields[index] = newFields[targetIdx];
    newFields[targetIdx] = temp;
    setEditingPage({
      ...editingPage,
      fields: newFields,
    });
  };

  const copyUrl = (slug: string) => {
    const full = `${window.location.origin}/landing/${brand}/${slug}`;
    navigator.clipboard.writeText(full);
    notifications.show({
      title: 'Copied',
      message: 'Landing page URL copied to clipboard',
      color: 'green',
    });
  };

  return (
    <Container size="xl" py="lg">
      <Stack gap="lg">
        {/* Header */}
        <Group justify="space-between" align="center" wrap="wrap">
          <Box>
            <Title order={2} size="h2" fw={800}>
              Landing Page Lead Collectors
            </Title>
            <Text size="sm" c="dimmed">
              Create and customize client landing pages with custom form fields mapped directly to SLG Lead properties. Updates are instant with zero Vercel rebuilds.
            </Text>
          </Box>
          <Group gap="xs">
            <Button
              leftSection={<IconWallet size={18} />}
              variant="light"
              color="teal"
              size="md"
              onClick={() => handleCreateFromTemplate('event_pass')}
            >
              VIP Pass Template
            </Button>
            <Button
              leftSection={<IconPlus size={18} />}
              color="indigo"
              size="md"
              onClick={handleOpenCreate}
            >
              Create Blank Page
            </Button>
          </Group>
        </Group>

        {/* List of Landing Pages */}
        {loading ? (
          <Group justify="center" py="xl">
            <Loader size="md" />
          </Group>
        ) : pages.length === 0 ? (
          <Paper p="xl" radius="md" withBorder style={{ textAlign: 'center' }}>
            <Stack align="center" gap="sm">
              <IconForms size={48} color={EVENT_PASS_COLORS.editorMuted} />
              <Title order={4}>No Landing Pages Yet</Title>
              <Text size="sm" c="dimmed" style={{ maxWidth: 450 }}>
                Build your first landing page lead collector for <strong>{brandLabel}</strong>. Choose from verified themes and customize form fields mapped to your CRM.
              </Text>
              <Button leftSection={<IconPlus size={18} />} onClick={handleOpenCreate} mt="sm">
                Build First Page
              </Button>
            </Stack>
          </Paper>
        ) : (
          <SimpleGrid cols={{ base: 1, md: 2, lg: 3 }} spacing="lg">
            {pages.map((p) => {
              const liveUrl = `/landing/${brand}/${p.slug}`;
              return (
                <Card key={p.id || p.slug} shadow="sm" radius="md" withBorder p="lg">
                  <Stack gap="sm" justify="space-between" style={{ height: '100%' }}>
                    <Box>
                      <Group justify="space-between" align="flex-start" mb="xs">
                        <Badge color={p.published ? 'green' : 'gray'} variant="light">
                          {p.published ? 'Live' : 'Draft'}
                        </Badge>
                        <Badge variant="outline" color="yellow">
                          {p.design?.themePreset || 'dark_emerald'}
                        </Badge>
                      </Group>

                      <Title order={4} lineClamp={1}>
                        {p.title}
                      </Title>
                      <Text size="xs" c="dimmed" ff="monospace" mt={2} lineClamp={1}>
                        /landing/{brand}/{p.slug}
                      </Text>
                      {p.heroHeadline && (
                        <Text size="sm" c="gray.6" mt="xs" lineClamp={2}>
                          {p.heroHeadline}
                        </Text>
                      )}
                    </Box>

                    <Box>
                      <Divider my="xs" />
                      <Group justify="space-between" mb="sm">
                        <Text size="xs" c="dimmed">
                          Fields: <strong>{p.fields?.length || 0}</strong>
                        </Text>
                        <Group gap="xs">
                          <Text size="xs" c="dimmed">
                            Views: <strong>{p.viewsCount || 0}</strong>
                          </Text>
                          <Text size="xs" c="green" fw={700}>
                            Leads: {p.submissionsCount || 0}
                          </Text>
                        </Group>
                      </Group>

                      <Group gap="xs" grow>
                        <Button
                          variant="light"
                          size="xs"
                          leftSection={<IconEdit size={14} />}
                          onClick={() => handleOpenEdit(p)}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="subtle"
                          size="xs"
                          leftSection={<IconCopy size={14} />}
                          onClick={() => copyUrl(p.slug)}
                        >
                          Copy
                        </Button>
                        <ActionIcon
                          variant="subtle"
                          color="blue"
                          size="md"
                          component="a"
                          href={liveUrl}
                          target="_blank"
                          rel="noreferrer"
                          title="Open live landing page"
                        >
                          <IconExternalLink size={16} />
                        </ActionIcon>
                        {p.id && (
                          <ActionIcon
                            variant="subtle"
                            color="red"
                            size="md"
                            onClick={() => handleDelete(p.id)}
                            title="Delete landing page"
                          >
                            <IconTrash size={16} />
                          </ActionIcon>
                        )}
                      </Group>
                    </Box>
                  </Stack>
                </Card>
              );
            })}
          </SimpleGrid>
        )}
      </Stack>

      {/* Editor Drawer / Modal */}
      <Drawer
        opened={editorOpen}
        onClose={() => setEditorOpen(false)}
        title={
          <Group gap="xs">
            <IconForms size={20} color={EVENT_PASS_COLORS.editorSelection} />
            <Text fw={700} size="md">
              {editingPage?.id ? 'Edit Landing Page' : 'Create New Landing Page'}
            </Text>
          </Group>
        }
        position="right"
        size="xl"
      >
        {editingPage && (
          <Stack gap="md" pb="xl">
            <Tabs value={activeTab} onChange={setActiveTab}>
              <Tabs.List>
                <Tabs.Tab value="blocks" leftSection={<IconComponents size={16} />}>
                  Blocks &amp; Modules
                </Tabs.Tab>
                <Tabs.Tab value="content" leftSection={<IconEdit size={16} />}>
                  Content &amp; Copy
                </Tabs.Tab>
                <Tabs.Tab value="fields" leftSection={<IconAdjustments size={16} />}>
                  Form Fields ({editingPage.fields.length})
                </Tabs.Tab>
                <Tabs.Tab value="checkin" leftSection={<IconQrcode size={16} />}>
                  Pass &amp; check-in
                </Tabs.Tab>
                <Tabs.Tab value="design" leftSection={<IconPalette size={16} />}>
                  Theme &amp; Style
                </Tabs.Tab>
                <Tabs.Tab value="settings" leftSection={<IconTemplate size={16} />}>
                  URL &amp; Legal
                </Tabs.Tab>
              </Tabs.List>

              {/* Tab 0: Modular Blocks (Enable/Show & Disable/Hide) */}
              <Tabs.Panel value="blocks" pt="md">
                <Stack gap="md">
                  <Box>
                    <Text size="sm" fw={700}>
                      Modular Landing Page Blocks
                    </Text>
                    <Text size="xs" c="dimmed">
                      Toggle specific sections on or off to create the exact layout for your campaign — from simple 1-field lead magnets to rich VIP event passes with digital wallet goods.
                    </Text>
                  </Box>

                  <Paper p="md" radius="md" withBorder>
                    <Stack gap="md">
                      <Group justify="space-between" align="center">
                        <Box style={{ maxWidth: 380 }}>
                          <Text size="sm" fw={600}>
                            Hero Banner Image
                          </Text>
                          <Text size="xs" c="dimmed">
                            Display high-resolution campaign banner graphic at the top of the card.
                          </Text>
                        </Box>
                        <Switch
                          size="md"
                          checked={editingPage.blocks?.showHeroBanner !== false}
                          onChange={(e) =>
                            setEditingPage({
                              ...editingPage,
                              blocks: {
                                ...(editingPage.blocks || DEFAULT_BLOCKS_CONFIG),
                                showHeroBanner: e.currentTarget.checked,
                              },
                            })
                          }
                        />
                      </Group>

                      <Divider />

                      <Group justify="space-between" align="center">
                        <Box style={{ maxWidth: 380 }}>
                          <Text size="sm" fw={600}>
                            Hero Headline &amp; Subheadline
                          </Text>
                          <Text size="xs" c="dimmed">
                            Display the introductory promo text, date range, and venue overview.
                          </Text>
                        </Box>
                        <Switch
                          size="md"
                          checked={editingPage.blocks?.showHeroCopy !== false}
                          onChange={(e) =>
                            setEditingPage({
                              ...editingPage,
                              blocks: {
                                ...(editingPage.blocks || DEFAULT_BLOCKS_CONFIG),
                                showHeroCopy: e.currentTarget.checked,
                              },
                            })
                          }
                        />
                      </Group>

                      <Divider />

                      <Group justify="space-between" align="center">
                        <Box style={{ maxWidth: 380 }}>
                          <Text size="sm" fw={600}>
                            Benefits &amp; Callout Bullets
                          </Text>
                          <Text size="xs" c="dimmed">
                            Show highlights, entry requirements, or prize draw details.
                          </Text>
                        </Box>
                        <Switch
                          size="md"
                          checked={editingPage.blocks?.showBullets !== false}
                          onChange={(e) =>
                            setEditingPage({
                              ...editingPage,
                              blocks: {
                                ...(editingPage.blocks || DEFAULT_BLOCKS_CONFIG),
                                showBullets: e.currentTarget.checked,
                              },
                            })
                          }
                        />
                      </Group>

                      <Divider />

                      <Group justify="space-between" align="center">
                        <Box style={{ maxWidth: 380 }}>
                          <Group gap={6} align="center">
                            <IconWallet size={16} color={EVENT_PASS_COLORS.accent} />
                            <Text size="sm" fw={600}>
                              Digital Goods: Apple &amp; Google Wallet Passes
                            </Text>
                          </Group>
                          <Text size="xs" c="dimmed">
                            Upon submission, generate QR code pass, Apple Wallet (.pkpass), and Google Wallet download buttons.
                          </Text>
                        </Box>
                        <Switch
                          size="md"
                          color="green"
                          checked={editingPage.blocks?.showDigitalPasses !== false}
                          onChange={(e) =>
                            setEditingPage({
                              ...editingPage,
                              blocks: {
                                ...(editingPage.blocks || DEFAULT_BLOCKS_CONFIG),
                                showDigitalPasses: e.currentTarget.checked,
                              },
                            })
                          }
                        />
                      </Group>

                      <Divider />

                      <Group justify="space-between" align="center">
                        <Box style={{ maxWidth: 380 }}>
                          <Text size="sm" fw={600}>
                            Event Calendar Invite (.ics)
                          </Text>
                          <Text size="xs" c="dimmed">
                            Allow attendees to save event dates directly to Apple/Google/Outlook Calendar.
                          </Text>
                        </Box>
                        <Switch
                          size="md"
                          checked={editingPage.blocks?.showCalendarInvite !== false}
                          onChange={(e) =>
                            setEditingPage({
                              ...editingPage,
                              blocks: {
                                ...(editingPage.blocks || DEFAULT_BLOCKS_CONFIG),
                                showCalendarInvite: e.currentTarget.checked,
                              },
                            })
                          }
                        />
                      </Group>

                      <Divider />

                      <Group justify="space-between" align="center">
                        <Box style={{ maxWidth: 380 }}>
                          <Text size="sm" fw={600}>
                            Footer Privacy Disclaimer
                          </Text>
                          <Text size="xs" c="dimmed">
                            Show legal data processing notice and privacy policy links below the submit button.
                          </Text>
                        </Box>
                        <Switch
                          size="md"
                          checked={editingPage.blocks?.showFooterDisclaimer !== false}
                          onChange={(e) =>
                            setEditingPage({
                              ...editingPage,
                              blocks: {
                                ...(editingPage.blocks || DEFAULT_BLOCKS_CONFIG),
                                showFooterDisclaimer: e.currentTarget.checked,
                              },
                            })
                          }
                        />
                      </Group>

                      <Divider />

                      <Group justify="space-between" align="center">
                        <Box style={{ maxWidth: 380 }}>
                          <Text size="sm" fw={600}>
                            Terms &amp; Conditions Modal Link
                          </Text>
                          <Text size="xs" c="dimmed">
                            Show clickable link that opens competition terms and full GTC.
                          </Text>
                        </Box>
                        <Switch
                          size="md"
                          checked={editingPage.blocks?.showTermsModal !== false}
                          onChange={(e) =>
                            setEditingPage({
                              ...editingPage,
                              blocks: {
                                ...(editingPage.blocks || DEFAULT_BLOCKS_CONFIG),
                                showTermsModal: e.currentTarget.checked,
                              },
                            })
                          }
                        />
                      </Group>
                    </Stack>
                  </Paper>
                </Stack>
              </Tabs.Panel>

              {/* Tab 1: Content */}
              <Tabs.Panel value="content" pt="md">
                <Stack gap="md">
                  <TextInput
                    label="Page Title"
                    required
                    placeholder="e.g. Free VIP Ticket Giveaway"
                    value={editingPage.title}
                    onChange={(e) => setEditingPage({ ...editingPage, title: e.target.value })}
                  />

                  <TextInput
                    label="Hero Banner Image URL"
                    placeholder="https://.../banner.jpg"
                    description="High-resolution banner displayed at the top of the luxury card"
                    value={editingPage.heroBannerUrl || ''}
                    onChange={(e) => setEditingPage({ ...editingPage, heroBannerUrl: e.target.value })}
                  />

                  <TextInput
                    label="Hero Banner Proportions (width/height)"
                    placeholder="1248/562"
                    description="Use the image's own width/height so the whole image shows, for example 1200/1181 for a square image. Leave empty for the wide email banner."
                    value={editingPage.heroBannerAspectRatio || ''}
                    onChange={(e) => setEditingPage({ ...editingPage, heroBannerAspectRatio: e.target.value })}
                  />

                  <Textarea
                    label="Hero Headline"
                    placeholder="e.g. Title sponsors are delighted to offer general admission tickets..."
                    minRows={2}
                    value={editingPage.heroHeadline || ''}
                    onChange={(e) => setEditingPage({ ...editingPage, heroHeadline: e.target.value })}
                  />

                  <Textarea
                    label="Event & Subheadline Briefing"
                    placeholder="e.g. Located at WV Active Aldersley between 14th – 22nd November..."
                    minRows={3}
                    value={editingPage.heroSubheadline || ''}
                    onChange={(e) => setEditingPage({ ...editingPage, heroSubheadline: e.target.value })}
                  />

                  <Textarea
                    label="Bullet Points / Callouts (one per line)"
                    placeholder="Simply complete the form below...&#10;We look forward to seeing the lucky winners!"
                    minRows={3}
                    value={(editingPage.bodyBullets || []).join('\n')}
                    onChange={(e) =>
                      setEditingPage({
                        ...editingPage,
                        bodyBullets: e.target.value.split('\n'),
                      })
                    }
                  />

                  <TextInput
                    label="CTA Button Text"
                    placeholder="e.g. Submit Entry"
                    value={editingPage.ctaButtonText || 'Submit Entry'}
                    onChange={(e) => setEditingPage({ ...editingPage, ctaButtonText: e.target.value })}
                  />

                  <Divider my="xs" />

                  <Title order={5}>Success State</Title>
                  <TextInput
                    label="Success Title"
                    placeholder="e.g. Thank You for Entering!"
                    value={editingPage.successTitle || ''}
                    onChange={(e) => setEditingPage({ ...editingPage, successTitle: e.target.value })}
                  />
                  <Textarea
                    label="Success Message"
                    placeholder="e.g. Ensure you're following us across social channels..."
                    minRows={2}
                    value={editingPage.successMessage || ''}
                    onChange={(e) => setEditingPage({ ...editingPage, successMessage: e.target.value })}
                  />

                  <Divider my="xs" />

                  <Title order={5}>Post-Submit Confirmation Email</Title>
                  <Text size="xs" c="dimmed">
                    Send a branded promotional or thank-you email via Resend after form submission, even when Digital Passes are turned off.
                  </Text>
                  <Switch
                    label="Send custom confirmation email on submit"
                    checked={editingPage.confirmationEmail?.enabled === true}
                    onChange={(e) =>
                      setEditingPage({
                        ...editingPage,
                        confirmationEmail: {
                          ...(editingPage.confirmationEmail || { enabled: false }),
                          enabled: e.currentTarget.checked,
                        },
                      })
                    }
                  />
                  {editingPage.confirmationEmail?.enabled && (
                    <Stack gap="sm">
                      <TextInput
                        label="Email Subject"
                        placeholder="e.g. Thank you for attending The Mr Vegas Grand Slam of Darts"
                        value={editingPage.confirmationEmail.subject || ''}
                        onChange={(e) =>
                          setEditingPage({
                            ...editingPage,
                            confirmationEmail: {
                              ...(editingPage.confirmationEmail as LandingPageConfirmationEmailConfig),
                              subject: e.target.value,
                            },
                          })
                        }
                      />
                      <TextInput
                        label="Greeting Prefix"
                        description="Rendered before the lead's name, e.g. 'Dear Csaba Moldovan,'"
                        placeholder="Dear"
                        value={editingPage.confirmationEmail.greetingPrefix || ''}
                        onChange={(e) =>
                          setEditingPage({
                            ...editingPage,
                            confirmationEmail: {
                              ...(editingPage.confirmationEmail as LandingPageConfirmationEmailConfig),
                              greetingPrefix: e.target.value,
                            },
                          })
                        }
                      />
                      <Textarea
                        label="Intro Message (Above Offer Image)"
                        minRows={3}
                        value={editingPage.confirmationEmail.bodyBeforeCta || ''}
                        onChange={(e) =>
                          setEditingPage({
                            ...editingPage,
                            confirmationEmail: {
                              ...(editingPage.confirmationEmail as LandingPageConfirmationEmailConfig),
                              bodyBeforeCta: e.target.value,
                            },
                          })
                        }
                      />
                      <TextInput
                        label="CTA Offer Image URL"
                        description="Relative `/landing/...` path or full `https://` image URL"
                        placeholder="/landing/vegas/mr-vegas-offer-banner.jpg"
                        value={editingPage.confirmationEmail.ctaImageUrl || ''}
                        onChange={(e) =>
                          setEditingPage({
                            ...editingPage,
                            confirmationEmail: {
                              ...(editingPage.confirmationEmail as LandingPageConfirmationEmailConfig),
                              ctaImageUrl: e.target.value,
                            },
                          })
                        }
                      />
                      <TextInput
                        label="CTA Image Destination URL"
                        placeholder="https://trk.affiliates.mrvegas.com/..."
                        value={editingPage.confirmationEmail.ctaLinkUrl || ''}
                        onChange={(e) =>
                          setEditingPage({
                            ...editingPage,
                            confirmationEmail: {
                              ...(editingPage.confirmationEmail as LandingPageConfirmationEmailConfig),
                              ctaLinkUrl: e.target.value,
                            },
                          })
                        }
                      />
                      <Textarea
                        label="Closing Message (Below Offer Image)"
                        minRows={3}
                        value={editingPage.confirmationEmail.bodyAfterCta || ''}
                        onChange={(e) =>
                          setEditingPage({
                            ...editingPage,
                            confirmationEmail: {
                              ...(editingPage.confirmationEmail as LandingPageConfirmationEmailConfig),
                              bodyAfterCta: e.target.value,
                            },
                          })
                        }
                      />
                      <TextInput
                        label="Signature Image URL"
                        description="Relative `/landing/...` path or full `https://` image URL"
                        placeholder="/landing/vegas/mr-vegas-grand-slam-signature.jpg"
                        value={editingPage.confirmationEmail.signatureImageUrl || ''}
                        onChange={(e) =>
                          setEditingPage({
                            ...editingPage,
                            confirmationEmail: {
                              ...(editingPage.confirmationEmail as LandingPageConfirmationEmailConfig),
                              signatureImageUrl: e.target.value,
                            },
                          })
                        }
                      />
                    </Stack>
                  )}
                </Stack>
              </Tabs.Panel>

              {/* Tab 2: Fields Mapped to Lead Properties */}
              <Tabs.Panel value="fields" pt="md">
                <Stack gap="md">
                  <Box>
                    <Text size="sm" fw={700} mb={4}>
                      Lead Property Field Selector
                    </Text>
                    <Text size="xs" c="dimmed" mb="sm">
                      Choose any SLG Lead property to add to the landing page form. All submissions are automatically parsed and structured into the client CRM pipeline.
                    </Text>

                    <Select
                      placeholder="Select a Lead property to add as a field..."
                      data={SLG_LEAD_PROPERTIES.map((p) => ({
                        value: p.key,
                        label: `${p.label} (${p.category} -> ${p.key})`,
                      }))}
                      onChange={(val) => {
                        if (val) handleAddField(val as LeadPropertyKey);
                      }}
                      searchable
                      clearable
                    />
                  </Box>

                  <Divider my="xs" />

                  <Title order={5}>Configured Form Fields ({editingPage.fields.length})</Title>

                  <Stack gap="sm">
                    {editingPage.fields.map((f, idx) => {
                      const propMeta = SLG_LEAD_PROPERTIES.find((p) => p.key === f.leadProperty);

                      return (
                        <Paper key={f.id} p="sm" radius="md" withBorder>
                          <Group justify="space-between" align="center" mb="xs">
                            <Group gap="xs">
                              <Badge color="indigo" size="sm">
                                {f.leadProperty}
                              </Badge>
                              <Badge variant="outline" size="sm">
                                {f.type}
                              </Badge>
                              {propMeta && (
                                <Text size="xs" c="dimmed">
                                  {propMeta.category}
                                </Text>
                              )}
                            </Group>

                            <Group gap={4}>
                              <ActionIcon
                                variant="subtle"
                                size="sm"
                                disabled={idx === 0}
                                onClick={() => handleMoveField(idx, 'up')}
                              >
                                <IconArrowUp size={14} />
                              </ActionIcon>
                              <ActionIcon
                                variant="subtle"
                                size="sm"
                                disabled={idx === editingPage.fields.length - 1}
                                onClick={() => handleMoveField(idx, 'down')}
                              >
                                <IconArrowDown size={14} />
                              </ActionIcon>
                              <ActionIcon
                                variant="subtle"
                                color="red"
                                size="sm"
                                onClick={() => handleRemoveField(f.id)}
                              >
                                <IconTrash size={14} />
                              </ActionIcon>
                            </Group>
                          </Group>

                          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
                            <TextInput
                              label="Display Label"
                              size="xs"
                              value={f.label}
                              onChange={(e) => {
                                const newFields = [...editingPage.fields];
                                newFields[idx].label = e.target.value;
                                setEditingPage({ ...editingPage, fields: newFields });
                              }}
                            />
                            <TextInput
                              label="Placeholder"
                              size="xs"
                              value={f.placeholder || ''}
                              onChange={(e) => {
                                const newFields = [...editingPage.fields];
                                newFields[idx].placeholder = e.target.value;
                                setEditingPage({ ...editingPage, fields: newFields });
                              }}
                            />
                          </SimpleGrid>

                          <Group justify="space-between" align="center" mt="xs">
                            <Select
                              label="Input Type"
                              size="xs"
                              style={{ width: 140 }}
                              data={[
                                { value: 'text', label: 'Text' },
                                { value: 'email', label: 'Email' },
                                { value: 'tel', label: 'Phone' },
                                { value: 'url', label: 'URL' },
                                { value: 'date', label: 'Date' },
                                { value: 'select', label: 'Select' },
                                { value: 'textarea', label: 'Textarea' },
                                { value: 'checkbox', label: 'Checkbox' },
                                { value: 'radio', label: 'Radio' },
                              ]}
                              value={f.type}
                              onChange={(val) => {
                                if (val) {
                                  const newFields = [...editingPage.fields];
                                  newFields[idx].type = val as any;
                                  setEditingPage({ ...editingPage, fields: newFields });
                                }
                              }}
                            />

                            <Checkbox
                              label="Required Field"
                              size="xs"
                              checked={f.required}
                              onChange={(e) => {
                                const newFields = [...editingPage.fields];
                                newFields[idx].required = e.currentTarget.checked;
                                setEditingPage({ ...editingPage, fields: newFields });
                              }}
                            />
                          </Group>

                          {f.type === 'radio' && (
                            <TextInput
                              label="Radio Options (comma-separated)"
                              size="xs"
                              mt="xs"
                              value={(f.options || ['Yes', 'No']).join(', ')}
                              onChange={(e) => {
                                const newFields = [...editingPage.fields];
                                newFields[idx].options = e.target.value.split(',').map((s) => s.trim());
                                setEditingPage({ ...editingPage, fields: newFields });
                              }}
                            />
                          )}
                        </Paper>
                      );
                    })}
                  </Stack>
                </Stack>
              </Tabs.Panel>

              {/* Tab 3: Design & Themes */}
              {/* Tab: Check-in scanner (QR reader for event staff) */}
              <Tabs.Panel value="checkin" pt="md">
                {(() => {
                  const scanner = editingPage.scanner ?? DEFAULT_SCANNER_CONFIG;
                  const setScanner = (patch: Partial<typeof scanner>) =>
                    setEditingPage({ ...editingPage, scanner: { ...scanner, ...patch } });
                  const readerPath = `/landing/${brand}/${editingPage.slug}/qrreader`;
                  return (
                    <Stack gap="md">
                      <Paper p="md" radius="md" withBorder>
                        <Stack gap="md">
                          <Box>
                            <Text size="sm" fw={700}>
                              Event pass details
                            </Text>
                            <Text size="xs" c="dimmed">
                              Printed on the attendee pass, the calendar entry and the confirmation email. Leave a field empty to leave
                              it off.
                            </Text>
                          </Box>
                          <TextInput
                            label="Event name"
                            description="Defaults to the page title."
                            value={editingPage.event?.name ?? ''}
                            maxLength={120}
                            onChange={(e) => setEditingPage({ ...editingPage, event: { ...editingPage.event, name: e.currentTarget.value } })}
                          />
                          <SimpleGrid cols={{ base: 1, sm: 2 }}>
                            <TextInput
                              label="Venue"
                              value={editingPage.event?.venue ?? ''}
                              maxLength={160}
                              onChange={(e) => setEditingPage({ ...editingPage, event: { ...editingPage.event, venue: e.currentTarget.value } })}
                            />
                            <TextInput
                              label="Date"
                              placeholder="e.g. 14 - 22 November 2026"
                              value={editingPage.event?.date ?? ''}
                              maxLength={80}
                              onChange={(e) => setEditingPage({ ...editingPage, event: { ...editingPage.event, date: e.currentTarget.value } })}
                            />
                          </SimpleGrid>
                        </Stack>
                      </Paper>

                      <Box>
                        <Text size="sm" fw={700}>
                          Check-in scanner
                        </Text>
                        <Text size="xs" c="dimmed">
                          Staff scan the QR code on the attendee pass with a phone. The matching lead moves to the column you choose, so
                          any landing page can feed the qualifier workflow.
                        </Text>
                      </Box>

                      <Paper p="md" radius="md" withBorder>
                        <Stack gap="md">
                          <Switch
                            label="Turn the check-in scanner on for this page"
                            checked={scanner.enabled}
                            onChange={(e) => setScanner({ enabled: e.currentTarget.checked })}
                          />

                          <Select
                            label="A scan moves the lead to"
                            description="A lead already further along the pipeline stays where it is."
                            data={SCANNER_TARGET_COLUMNS.map((column) => ({ value: column, label: columnLabel(column) }))}
                            value={scanner.targetColumn}
                            allowDeselect={false}
                            onChange={(value) => value && setScanner({ targetColumn: value as typeof scanner.targetColumn })}
                          />

                          <TextInput
                            key={`${editingPage.id ?? 'new'}-tags`}
                            label="Tags added on check-in"
                            description="Comma separated, up to 8."
                            defaultValue={scanner.tags.join(', ')}
                            onBlur={(e) => setScanner({ tags: e.currentTarget.value.split(',') })}
                          />

                          <Switch
                            label="A scan with no matching lead creates one (walk-in)"
                            checked={scanner.createUnknownLeads}
                            onChange={(e) => setScanner({ createUnknownLeads: e.currentTarget.checked })}
                          />

                          <SimpleGrid cols={{ base: 1, sm: 2 }}>
                            <TextInput
                              label="Result headline"
                              description="Large text on the green screen."
                              value={scanner.successHeadline}
                              maxLength={60}
                              onChange={(e) => setScanner({ successHeadline: e.currentTarget.value })}
                            />
                            <TextInput
                              label="Result line"
                              description="Smaller line under it."
                              value={scanner.successMessage}
                              maxLength={80}
                              onChange={(e) => setScanner({ successMessage: e.currentTarget.value })}
                            />
                          </SimpleGrid>

                          <TextInput
                            label="Access code"
                            description="Staff type this to unlock the scanner. It is stored on the server and never sent to visitors."
                            required={scanner.enabled}
                            error={scanner.enabled && !scanner.accessCode ? 'Set a code to turn the scanner on' : undefined}
                            value={scanner.accessCode ?? ''}
                            maxLength={80}
                            autoComplete="off"
                            onChange={(e) => setScanner({ accessCode: e.currentTarget.value })}
                          />

                          <Switch
                            label="Show the access code on the unlock screen"
                            description="Anyone who opens the scanner link can read it. Leave off unless the link is only shared with staff."
                            checked={scanner.showAccessCodeHint}
                            onChange={(e) => setScanner({ showAccessCodeHint: e.currentTarget.checked })}
                          />
                        </Stack>
                      </Paper>

                      <Paper p="md" radius="md" withBorder>
                        <Group justify="space-between" align="center" wrap="nowrap">
                          <Box style={{ minWidth: 0 }}>
                            <Text size="sm" fw={600}>
                              Scanner link for staff
                            </Text>
                            <Text size="xs" c="dimmed" style={{ wordBreak: 'break-all' }}>
                              {readerPath}
                            </Text>
                            {!editingPage.id && (
                              <Text size="xs" c="orange">
                                Save the page first; the link works once the page is saved with the scanner on.
                              </Text>
                            )}
                          </Box>
                          <Group gap="xs" wrap="nowrap">
                            <Tooltip label="Copy link">
                              <ActionIcon
                                variant="light"
                                aria-label="Copy the scanner link"
                                onClick={() => {
                                  navigator.clipboard?.writeText(`${window.location.origin}${readerPath}`);
                                  notifications.show({ message: 'Scanner link copied', color: 'green' });
                                }}
                              >
                                <IconCopy size={16} />
                              </ActionIcon>
                            </Tooltip>
                            <Tooltip label="Open scanner">
                              <ActionIcon
                                variant="light"
                                component="a"
                                href={readerPath}
                                target="_blank"
                                rel="noopener noreferrer"
                                aria-label="Open the scanner"
                              >
                                <IconExternalLink size={16} />
                              </ActionIcon>
                            </Tooltip>
                          </Group>
                        </Group>
                      </Paper>
                    </Stack>
                  );
                })()}
              </Tabs.Panel>

              <Tabs.Panel value="design" pt="md">
                <Stack gap="md">
                  <Box>
                    <Text size="sm" fw={700} mb="xs">
                      Theme Presets
                    </Text>
                    <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                      {Object.entries(THEME_PRESETS).map(([key, preset]) => {
                        const isSelected = editingPage.design?.themePreset === key;
                        return (
                          <Paper
                            key={key}
                            p="sm"
                            radius="md"
                            withBorder
                            style={{
                              cursor: 'pointer',
                              borderColor: isSelected ? EVENT_PASS_COLORS.editorSelection : undefined,
                              backgroundColor: preset.cardBackgroundColor,
                              color: preset.textColor,
                            }}
                            onClick={() =>
                              setEditingPage({
                                ...editingPage,
                                design: preset,
                              })
                            }
                          >
                            <Group justify="space-between">
                              <Text size="sm" fw={700} c={preset.accentColor}>
                                {key.replace('_', ' ').toUpperCase()}
                              </Text>
                              <Box
                                style={{
                                  width: 18,
                                  height: 18,
                                  borderRadius: '50%',
                                  backgroundColor: preset.primaryColor,
                                }}
                              />
                            </Group>
                          </Paper>
                        );
                      })}
                    </SimpleGrid>
                  </Box>

                  <Divider my="xs" />

                  <Title order={5}>Custom Color Palette</Title>
                  <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                    <TextInput
                      label="Primary Brand Color"
                      value={editingPage.design?.primaryColor || EVENT_PASS_COLORS.primary}
                      onChange={(e) =>
                        setEditingPage({
                          ...editingPage,
                          design: {
                            ...editingPage.design,
                            primaryColor: e.target.value,
                          },
                        })
                      }
                    />
                    <TextInput
                      label="Accent / Gold Color"
                      value={editingPage.design?.accentColor || EVENT_PASS_COLORS.gold}
                      onChange={(e) =>
                        setEditingPage({
                          ...editingPage,
                          design: {
                            ...editingPage.design,
                            accentColor: e.target.value,
                          },
                        })
                      }
                    />
                    <TextInput
                      label="Background Color"
                      value={editingPage.design?.backgroundColor || EVENT_PASS_COLORS.emeraldPage}
                      onChange={(e) =>
                        setEditingPage({
                          ...editingPage,
                          design: {
                            ...editingPage.design,
                            backgroundColor: e.target.value,
                          },
                        })
                      }
                    />
                    <TextInput
                      label="Card Color"
                      value={editingPage.design?.cardBackgroundColor || EVENT_PASS_COLORS.emeraldCard}
                      onChange={(e) =>
                        setEditingPage({
                          ...editingPage,
                          design: {
                            ...editingPage.design,
                            cardBackgroundColor: e.target.value,
                          },
                        })
                      }
                    />
                  </SimpleGrid>
                </Stack>
              </Tabs.Panel>

              {/* Tab 4: URL, Publish, & Legal */}
              <Tabs.Panel value="settings" pt="md">
                <Stack gap="md">
                  <TextInput
                    label="URL Slug"
                    required
                    description={`Live path: /landing/${brand}/${editingPage.slug}`}
                    placeholder="e.g. spring-giveaway-2026"
                    value={editingPage.slug}
                    onChange={(e) =>
                      setEditingPage({
                        ...editingPage,
                        slug: e.target.value.toLowerCase().replace(/[^a-z0-9-_]/g, '-'),
                      })
                    }
                  />

                  <Switch
                    label="Publish to Live Web (Immediate)"
                    description="When enabled, the landing page is instantly accessible to prospects"
                    checked={editingPage.published}
                    onChange={(e) =>
                      setEditingPage({
                        ...editingPage,
                        published: e.currentTarget.checked,
                      })
                    }
                  />

                  <Divider my="xs" />

                  <Textarea
                    label="Footer Legal Disclaimer"
                    placeholder="By entering you are agreeing to share your personal data..."
                    minRows={2}
                    value={editingPage.footerDisclaimer || ''}
                    onChange={(e) =>
                      setEditingPage({
                        ...editingPage,
                        footerDisclaimer: e.target.value,
                      })
                    }
                  />

                  <Textarea
                    label="Terms & Conditions (Modal Text)"
                    placeholder="1. Promoter details...&#10;2. Eligibility requirements (18+)..."
                    minRows={4}
                    value={editingPage.termsHtml || ''}
                    onChange={(e) =>
                      setEditingPage({
                        ...editingPage,
                        termsHtml: e.target.value,
                      })
                    }
                  />
                </Stack>
              </Tabs.Panel>
            </Tabs>

            <Divider my="sm" />

            <Group justify="flex-end" gap="sm">
              <Button variant="default" onClick={() => setEditorOpen(false)}>
                Cancel
              </Button>
              <Button
                color="indigo"
                leftSection={<IconDeviceFloppy size={18} />}
                loading={saving}
                onClick={handleSavePage}
              >
                Save &amp; Publish Instantly
              </Button>
            </Group>
          </Stack>
        )}
      </Drawer>
    </Container>
  );
}
