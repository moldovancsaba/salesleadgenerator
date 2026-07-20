"use client";

import {
  Box,
  Card,
  Text,
  Badge,
  Group,
  Stack,
  Progress,
  type MantineColor,
} from "@mantine/core";
import type { ReactNode } from "react";
import type { SemanticTone } from "../theme/semantic";

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
  const regionColors: Record<string, MantineColor> = {
    US: "blue",
    CEE: "green",
    MENA: "orange",
  };

  const safeQuality = qualityStatus || "DRAFT";
  const qualityColors: Record<string, MantineColor> = {
    VERIFIED: "green",
    CHECKED: "blue",
    DRAFT: "gray",
  };

  const icePercent = iceScore ? Math.min(100, (iceScore / 1000) * 100) : 0;

  return (
    <Card
      shadow="sm"
      padding="md"
      radius="md"
      withBorder
      style={{
        cursor: onClick ? "pointer" : "default",
        transition: "all 0.2s",
      }}
      onClick={onClick}
    >
      <Stack gap="sm">
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
              <Text size="xs" fw={600} c={tone}>
                ICE: {iceScore}
              </Text>
              <Progress value={icePercent} size="xs" w={60} color={tone} />
            </Stack>
          )}
        </Group>

        {/* Badges */}
        <Group gap="xs">
          <Badge size="xs" variant="light" color={regionColors[region] || "gray"}>
            {region}
          </Badge>
          <Badge size="xs" variant="light" color={qualityColors[safeQuality] || "gray"}>
            {safeQuality}
          </Badge>
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
    </Card>
  );
}
