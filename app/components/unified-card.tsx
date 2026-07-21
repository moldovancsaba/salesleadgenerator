"use client";

import {
  Box,
  Text,
  Badge,
  Group,
  Stack,
  Progress,
} from "@mantine/core";
import type { ReactNode } from "react";
import type { SemanticTone } from "../theme/semantic";
import { semanticToneToMantineColor } from "../utils/semantic-colors";
import { tokens } from "../theme/tokens";
import { SemanticBadge } from "./ui/semantic-badge";
import { CardShell } from "./ui/card-shell";

type Props = {
  title: string;
  subtitle?: string;
  iceScore?: number;
  region: "US" | "CEE" | "MENA";
  qualityStatus: "VERIFIED" | "CHECKED" | "DRAFT";
  decisionMaker?: string;
  decisionMakerTitle?: string;
  feedbackScore?: number;
  declineCount?: number;
  tone?: SemanticTone;
  onClick?: () => void;
  children?: ReactNode;
};

const cardStyle = {
  cursor: "pointer",
  transition: "transform 0.1s, box-shadow 0.1s",
};

export function UnifiedCard({
  title,
  subtitle,
  iceScore,
  region,
  qualityStatus,
  decisionMaker,
  decisionMakerTitle,
  feedbackScore = 0,
  declineCount = 0,
  tone = "neutral",
  onClick,
  children,
}: Props) {
  const safeQuality = qualityStatus || "DRAFT";
  const iceToneColor = semanticToneToMantineColor(tone);

  const icePercent = iceScore ? Math.min(100, (iceScore / 1000) * 100) : 0;

  return (
    <CardShell onClick={onClick} style={cardStyle}>
      <Stack gap={tokens.spacing.sm}>
        {/* Header */}
        <Group justify="space-between" align="flex-start">
          <Stack gap={0} style={{ flex: 1 }}>
            <Text fw={600} size="md" lineClamp={1}>
              {title}
            </Text>
            {subtitle && (
              <Text size="xs" c="dimmed" lineClamp={1}>
                {subtitle}
              </Text>
            )}
          </Stack>
          {iceScore !== undefined && (
            <Stack gap={2} align="flex-end">
              <Text size="xs" fw={600} c={iceToneColor}>
                ICE: {iceScore}
              </Text>
              <Progress value={icePercent} size="xs" w={60} color={iceToneColor} />
            </Stack>
          )}
        </Group>

        {/* Badges */}
        <Group gap="xs">
          <SemanticBadge tone={region === 'US' ? 'ingress' : region === 'CEE' ? 'synthesis' : 'tactical'} label={region} />
          <SemanticBadge tone={safeQuality === 'VERIFIED' ? 'review' : safeQuality === 'CHECKED' ? 'strategy' : 'checklist'} label={safeQuality} />
          {feedbackScore > 0 && (
            <Badge size="xs" variant="light" color="green">
              ↑ {feedbackScore}
            </Badge>
          )}
          {declineCount > 0 && (
            <Badge size="xs" variant="light" color="red">
              ↓ {declineCount}
            </Badge>
          )}
        </Group>

        {/* Decision Maker */}
        {decisionMaker && (
          <Box>
            <Text size="xs" c="dimmed" fw={500}>
              Decision Maker
            </Text>
            <Text size="sm" lineClamp={1}>
              {decisionMaker}
            </Text>
            {decisionMakerTitle && (
              <Text size="xs" c="dimmed" lineClamp={1}>
                {decisionMakerTitle}
              </Text>
            )}
          </Box>
        )}

        {/* Additional content */}
        {children}
      </Stack>
    </CardShell>
  );
}
