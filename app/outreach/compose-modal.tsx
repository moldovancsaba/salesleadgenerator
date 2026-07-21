'use client';

import { useState, useEffect } from 'react';
import { Modal, Stack, Group, Text, Button, Textarea, Select, Loader, Paper, Title } from '@mantine/core';
import { IconX } from '@tabler/icons-react';
import { evaluateOutreachRouting } from '../lib/outreach/routing-rules';

type Props = {
  opened: boolean;
  onClose: () => void;
  lead: {
    _id: string;
    entity_name?: string;
    decision_maker_name?: string;
    decision_maker_title?: string;
    decision_maker_contact?: string;
    value_proposition?: string;
    sport_or_sector?: string;
    industry?: string;
    url?: string;
    country?: string;
    region?: string;
    [key: string]: any;
  };
  brand?: string;
  onSent?: (payload: { leadId: string; templateId?: string; channel: 'email' | 'linkedin'; subject?: string; body: string }) => void;
};

type Template = {
  id: string;
  name: string;
  channel: 'email' | 'linkedin';
  industry: string;
  subject?: string;
  body: string;
  variables: string[];
};

function interpolate(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce((text, [key, value]) => {
    const safeValue = typeof value === 'string' ? value : String(value ?? '');
    return text.replace(new RegExp(`\\{${key}\\}`, 'g'), safeValue);
  }, template);
}

export function OutreachComposeModal({ opened, onClose, lead, brand = 'default', onSent }: Props) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(false);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [channel, setChannel] = useState<'email' | 'linkedin'>('email');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);

  const industry = lead.industry || lead.sport_or_sector || '';
  const routeResult = evaluateOutreachRouting(channel, lead, body);
  const channelBlockReason = routeResult.allowed ? undefined : routeResult.reason;
  const canSendEmail = channel === 'email' && routeResult.allowed && body.trim().length > 0 && (channel === 'email' ? subject.trim().length > 0 : true);
  const canSendLinkedIn = channel === 'linkedin' && routeResult.allowed && body.trim().length > 0;
  const canSend = channel === 'email' ? canSendEmail : canSendLinkedIn;

  useEffect(() => {
    if (!opened) return;
    let cancelled = false;
    setLoading(true);
    fetch(`/api/outreach-templates?brand=${brand}${industry ? `&industry=${encodeURIComponent(industry)}` : ''}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const items: Template[] = data.templates || [];
        setTemplates(items);
        if (items.length > 0) {
          const first = items[0];
          setTemplateId(first.id)
          setChannel(first.channel)
          setSubject(first.subject || '')
          setBody(interpolate(first.body, lead))
        }
      })
      .catch(() => {
        if (cancelled) return;
        setTemplates([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      })

    return () => {
      cancelled = true;
    }
  }, [opened, brand, lead.entity_name, industry])

  useEffect(() => {
    const found = templates.find((t) => t.id === templateId)
    if (!found) return;
    setChannel(found.channel)
    setSubject(found.subject || '')
    setBody(interpolate(found.body, lead))
  }, [templateId])

  async function handleSend() {
    if (!body.trim()) return;
    if (channel === 'email' && !subject.trim()) {
      return;
    }
    setSending(true);
    try {
      await fetch('/api/outreach-logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brand,
          leadId: lead._id,
          templateId: templateId || undefined,
          channel,
          subject: channel === 'email' ? subject : undefined,
          body,
          decision_maker_contact: lead.decision_maker_contact,
          decision_maker_name: lead.decision_maker_name,
          url: lead.url,
          industry: lead.industry,
          sport_or_sector: lead.sport_or_sector,
        }),
      })
      onSent?.({ leadId: lead._id, templateId: templateId || undefined, channel, subject, body })
      onClose()
    } catch (err) {
      console.error('Outreach log failed', err);
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal opened={opened} onClose={onClose} title={<Title order={4}>Outreach</Title>} centered withinPortal={false}>
      <Stack gap="sm">
        {loading ? (
          <Paper p="md" withBorder>
            <Group gap="sm"><Loader size="xs" /> <Text size="sm">Loading templates…</Text></Group>
          </Paper>
        ) : templates.length === 0 ? (
          <Paper p="md" withBorder>
            <Text size="sm" c="dimmed">No matching templates for {industry || 'this lead'}.</Text>
          </Paper>
        ) : (
          <>
            <Select
              label="Template"
              data={templates.map((t) => ({ value: t.id, label: t.name }))}
              value={templateId}
              onChange={(value) => setTemplateId(value || null)}
            />
            <Textarea
              label={channel === 'email' ? 'Subject' : 'Channel'}
              value={channel === 'email' ? subject : channel.toUpperCase()}
              onChange={(e) => {
                if (channel === 'email') setSubject(e.target.value)
              }}
              disabled={channel !== 'email'}
            />
            <Textarea
              label="Message"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={8}
              description="Variables are pre-filled from the lead."
            />
            <Group justify="flex-end" gap="sm">
              <Button variant="light" onClick={onClose} disabled={sending}>Cancel</Button>
              <Button onClick={handleSend} disabled={!canSend || sending}>{sending ? 'Sending…' : 'Log outreach'}</Button>
            </Group>
            {channelBlockReason && (
              <Text size="xs" c="red">{channelBlockReason}</Text>
            )}
          </>
        )}
      </Stack>
    </Modal>
  );
}
