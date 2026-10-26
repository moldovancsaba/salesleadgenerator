'use client';

import React from 'react';
import Link from 'next/link';
import {
  Container,
  Text,
  Button,
  Stack,
  Title,
  Group,
  Accordion,
  Divider,
  Box,
  List,
  ThemeIcon,
  Badge,
} from '@mantine/core';
import {
  IconLogin,
  IconArrowRight,
  IconMail,
  IconLayoutKanban,
  IconFileCheck,
  IconSend,
  IconCompass,
  IconSparkles,
  IconCalendar,
  IconUsers,
  IconArrowsExchange,
  IconCheck,
  IconShieldLock,
  IconBrandGoogle,
  IconChartBar,
} from '@tabler/icons-react';
import { StatusBadge, LabelTag, CountBadge } from '@sovereignsquad/gds-core/client';
import { useAuth } from './components/AuthProvider';
import { LANDING_CONTENT, LandingFeature } from '@/content/landing';
import { APP_VERSION } from '@/lib/release-notes-dates';
import styles from './page.module.css';

function getFeatureIcon(iconName: string) {
  switch (iconName) {
    case 'IconMail':
      return <IconMail size={22} />;
    case 'IconLayoutKanban':
      return <IconLayoutKanban size={22} />;
    case 'IconFileCheck':
      return <IconFileCheck size={22} />;
    case 'IconSend':
      return <IconSend size={22} />;
    case 'IconCompass':
      return <IconCompass size={22} />;
    case 'IconSparkles':
      return <IconSparkles size={22} />;
    case 'IconCalendar':
      return <IconCalendar size={22} />;
    case 'IconUsers':
      return <IconUsers size={22} />;
    case 'IconArrowsExchange':
      return <IconArrowsExchange size={22} />;
    default:
      return <IconChartBar size={22} />;
  }
}

export default function LandingPage() {
  const { user, loading, login } = useAuth();
  const c = LANDING_CONTENT;

  return (
    <div className={styles.landingRoot}>
      {/* 1. Header / Navbar */}
      <header className={styles.navbar}>
        <div className={styles.container}>
          <div className={styles.navInner}>
            <Group gap="xs" align="center">
              <ThemeIcon size={32} radius="md" color="indigo" variant="filled">
                <IconLayoutKanban size={20} />
              </ThemeIcon>
              <Title order={3} size="h4" fw={700}>
                {c.navigation.brandName}
              </Title>
              <LabelTag tone="info" size="xs" label={`v${APP_VERSION}`} />
            </Group>

            <div className={styles.navLinks}>
              {c.navigation.links.map((link) => (
                <Text
                  key={link.href}
                  component="a"
                  href={link.href}
                  size="sm"
                  fw={500}
                  c="dimmed"
                  style={{ textDecoration: 'none' }}
                >
                  {link.label}
                </Text>
              ))}
            </div>

            <Group gap="xs">
              {!loading && user ? (
                <Button
                  component={Link}
                  href="/sales/seyu"
                  size="xs"
                  color="indigo"
                  rightSection={<IconArrowRight size={14} />}
                >
                  {c.navigation.dashboardLabel}
                </Button>
              ) : (
                <>
                  <Button
                    variant="subtle"
                    size="xs"
                    onClick={login}
                    leftSection={<IconLogin size={14} />}
                  >
                    {c.navigation.signInLabel}
                  </Button>
                  <Button
                    component="a"
                    href={c.navigation.contactHref}
                    size="xs"
                    color="indigo"
                    variant="light"
                  >
                    {c.navigation.contactLabel}
                  </Button>
                </>
              )}
            </Group>
          </div>
        </div>
      </header>

      {/* 2. Hero Section */}
      <section className={styles.hero}>
        <div className={styles.container}>
          <div className={styles.heroContent}>
            <StatusBadge status="info" size="md">
              {c.hero.pillBadge}
            </StatusBadge>

            <h1 className={styles.heroTitle}>
              {c.hero.title}{' '}
              <span className={styles.heroHighlight}>{c.hero.titleHighlight}</span>
            </h1>

            <p className={styles.heroSubtitle}>{c.hero.subtitle}</p>

            <div className={styles.heroCtas}>
              {!loading && user ? (
                <Button
                  component={Link}
                  href="/sales/seyu"
                  size="md"
                  color="indigo"
                  rightSection={<IconArrowRight size={16} />}
                >
                  {c.hero.dashboardCta.label}
                </Button>
              ) : (
                <>
                  <Button
                    component="a"
                    href={c.hero.primaryCta.href}
                    size="md"
                    color="indigo"
                    rightSection={<IconArrowRight size={16} />}
                  >
                    {c.hero.primaryCta.label}
                  </Button>
                  <Button
                    variant="default"
                    size="md"
                    onClick={login}
                    leftSection={<IconLogin size={16} />}
                  >
                    Sign in with SSO
                  </Button>
                </>
              )}
            </div>

            {/* Trust Badges */}
            <div className={styles.trustList}>
              {c.hero.trustBadges.map((badge, idx) => (
                <Badge
                  key={idx}
                  variant="outline"
                  color="gray"
                  size="sm"
                  leftSection={<IconCheck size={12} color="var(--mantine-color-teal-6)" />}
                >
                  {badge}
                </Badge>
              ))}
            </div>
          </div>

          {/* Metrics Grid */}
          <div className={styles.metricsGrid}>
            {c.metrics.map((metric, idx) => (
              <div key={idx} className={styles.metricCard}>
                <Text size="xl" fw={800} c="indigo">
                  {metric.value}
                </Text>
                <Text size="sm" fw={600}>
                  {metric.label}
                </Text>
                <Text size="xs" c="dimmed">
                  {metric.subtext}
                </Text>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 3. Value Pillars Section */}
      <section id="pillars" className={styles.sectionAlt}>
        <div className={styles.container}>
          <div className={styles.sectionHeader}>
            <LabelTag tone="info" size="xs" label={c.valuePillars.sectionBadge} />
            <h2 className={styles.sectionTitle}>{c.valuePillars.sectionTitle}</h2>
            <p className={styles.sectionSubtitle}>{c.valuePillars.sectionSubtitle}</p>
          </div>

          <div className={styles.pillarsGrid}>
            {c.valuePillars.pillars.map((pillar, idx) => (
              <div key={idx} className={styles.pillarCard}>
                <StatusBadge status="neutral" size="sm">
                  {pillar.badge}
                </StatusBadge>
                <Title order={3} size="h4" mt="sm" mb="xs">
                  {pillar.title}
                </Title>
                <Text size="sm" fw={600} mb="xs">
                  {pillar.lead}
                </Text>
                <Text size="sm" c="dimmed" lh={1.6}>
                  {pillar.body}
                </Text>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 4. Workflow Section */}
      <section id="workflow" className={styles.section}>
        <div className={styles.container}>
          <div className={styles.sectionHeader}>
            <LabelTag tone="neutral" size="xs" label={c.workflow.sectionBadge} />
            <h2 className={styles.sectionTitle}>{c.workflow.sectionTitle}</h2>
            <p className={styles.sectionSubtitle}>{c.workflow.sectionSubtitle}</p>
          </div>

          <div className={styles.workflowGrid}>
            {c.workflow.steps.map((st) => (
              <div key={st.step} className={styles.workflowCard}>
                <span className={styles.stepNumber}>{st.step}</span>
                <Title order={4} size="h5" mb="xs">
                  {st.title}
                </Title>
                <Text size="sm" c="dimmed" lh={1.5} mb="md">
                  {st.description}
                </Text>
                <Box mt="auto" pt="xs" style={{ borderTop: '1px solid var(--gds-border-card)' }}>
                  <Text size="xs" fw={600} c="dimmed" tt="uppercase" mb={2}>
                    Key Deliverable
                  </Text>
                  <Text size="xs" fw={500}>
                    {st.deliverable}
                  </Text>
                </Box>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 5. Features Section */}
      <section id="features" className={styles.sectionAlt}>
        <div className={styles.container}>
          <div className={styles.sectionHeader}>
            <LabelTag tone="info" size="xs" label={c.features.sectionBadge} />
            <h2 className={styles.sectionTitle}>{c.features.sectionTitle}</h2>
            <p className={styles.sectionSubtitle}>{c.features.sectionSubtitle}</p>
          </div>

          <div className={styles.featuresGrid}>
            {c.features.items.map((feat) => (
              <div key={feat.id} className={styles.featureCard}>
                <Group justify="space-between" align="center" mb="xs">
                  <ThemeIcon size={38} radius="md" color="indigo" variant="light">
                    {getFeatureIcon(feat.iconName)}
                  </ThemeIcon>
                  <StatusBadge status="neutral" size="xs">
                    {feat.badge}
                  </StatusBadge>
                </Group>
                <Title order={4} size="h5" mb="xs">
                  {feat.title}
                </Title>
                <Text size="sm" c="dimmed" lh={1.6}>
                  {feat.description}
                </Text>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 6. Pricing Section */}
      <section id="pricing" className={styles.section}>
        <div className={styles.container}>
          <div className={styles.sectionHeader}>
            <LabelTag tone="neutral" size="xs" label={c.pricing.sectionBadge} />
            <h2 className={styles.sectionTitle}>{c.pricing.sectionTitle}</h2>
            <p className={styles.sectionSubtitle}>{c.pricing.sectionSubtitle}</p>
          </div>

          <div className={styles.pricingGrid}>
            {c.pricing.tiers.map((tier) => (
              <div
                key={tier.id}
                className={tier.highlighted ? styles.pricingCardHighlighted : styles.pricingCard}
              >
                {tier.highlighted && (
                  <Badge
                    color="indigo"
                    variant="filled"
                    size="xs"
                    style={{ position: 'absolute', top: 12, right: 16 }}
                  >
                    Recommended
                  </Badge>
                )}

                <Title order={3} size="h4" mb={4}>
                  {tier.name}
                </Title>
                <Text size="xs" c="dimmed" mb="md">
                  {tier.tagline}
                </Text>

                <Group gap={4} align="baseline" mb="md">
                  <Text size="xl" fw={800}>
                    {tier.price}
                  </Text>
                  <Text size="xs" c="dimmed">
                    / {tier.cadence}
                  </Text>
                </Group>

                <Divider my="xs" />

                <List
                  spacing="xs"
                  size="sm"
                  center
                  icon={
                    <ThemeIcon color="teal" size={18} radius="xl">
                      <IconCheck size={12} />
                    </ThemeIcon>
                  }
                  mb="xl"
                >
                  {tier.features.map((feat, fIdx) => (
                    <List.Item key={fIdx}>{feat}</List.Item>
                  ))}
                </List>

                <Box mt="auto">
                  <Button
                    component="a"
                    href={tier.ctaHref}
                    fullWidth
                    color={tier.highlighted ? 'indigo' : 'gray'}
                    variant={tier.highlighted ? 'filled' : 'outline'}
                    size="sm"
                  >
                    {tier.ctaLabel}
                  </Button>
                </Box>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 7. FAQ Section */}
      <section id="faq" className={styles.sectionAlt}>
        <div className={styles.container}>
          <div className={styles.sectionHeader}>
            <LabelTag tone="info" size="xs" label={c.faq.sectionBadge} />
            <h2 className={styles.sectionTitle}>{c.faq.sectionTitle}</h2>
            <p className={styles.sectionSubtitle}>{c.faq.sectionSubtitle}</p>
          </div>

          <div className={styles.faqContainer}>
            <Accordion variant="separated" radius="md">
              {c.faq.items.map((item, idx) => (
                <Accordion.Item key={idx} value={`item-${idx}`}>
                  <Accordion.Control>
                    <Text fw={600} size="sm">
                      {item.question}
                    </Text>
                  </Accordion.Control>
                  <Accordion.Panel>
                    <Text size="sm" c="dimmed" lh={1.6}>
                      {item.answer}
                    </Text>
                  </Accordion.Panel>
                </Accordion.Item>
              ))}
            </Accordion>
          </div>
        </div>
      </section>

      {/* 8. Call to Action Banner */}
      <section className={styles.section}>
        <div className={styles.container}>
          <div className={styles.ctaBanner}>
            <StatusBadge status="warning" size="sm">
              {c.ctaBanner.badge}
            </StatusBadge>
            <Title order={2} size="h2" c="white" style={{ maxWidth: 640 }}>
              {c.ctaBanner.title}
            </Title>
            <Text c="gray.3" size="md" style={{ maxWidth: 580 }} lh={1.6}>
              {c.ctaBanner.subtitle}
            </Text>

            <Group gap="sm" mt="sm">
              <Button
                component="a"
                href={c.ctaBanner.primaryCta.href}
                size="md"
                color="indigo"
                variant="white"
                rightSection={<IconArrowRight size={16} />}
              >
                {c.ctaBanner.primaryCta.label}
              </Button>
              <Button
                component={Link}
                href={c.ctaBanner.secondaryCta.href}
                size="md"
                variant="subtle"
                c="white"
              >
                {c.ctaBanner.secondaryCta.label}
              </Button>
            </Group>
          </div>
        </div>
      </section>

      {/* 9. Footer */}
      <footer className={styles.footer}>
        <div className={styles.container}>
          <div className={styles.footerInner}>
            <Stack gap={4}>
              <Group gap="xs">
                <ThemeIcon size={24} radius="sm" color="indigo" variant="filled">
                  <IconLayoutKanban size={14} />
                </ThemeIcon>
                <Text fw={700} size="sm">
                  {c.navigation.brandName}
                </Text>
                <Text size="xs" c="dimmed">
                  v{APP_VERSION}
                </Text>
              </Group>
              <Text size="xs" c="dimmed">
                {c.footer.tagline}
              </Text>
              <Text size="xs" c="dimmed">
                {c.footer.copyright}
              </Text>
            </Stack>

            <Group gap="md">
              {c.footer.links.map((link) =>
                link.href.startsWith('/') ? (
                  <Text
                    key={link.href}
                    component={Link}
                    href={link.href}
                    size="xs"
                    c="dimmed"
                    style={{ textDecoration: 'none' }}
                  >
                    {link.label}
                  </Text>
                ) : (
                  <Text
                    key={link.href}
                    component="a"
                    href={link.href}
                    size="xs"
                    c="dimmed"
                    style={{ textDecoration: 'none' }}
                  >
                    {link.label}
                  </Text>
                )
              )}
            </Group>
          </div>
        </div>
      </footer>
    </div>
  );
}
