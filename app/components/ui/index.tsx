'use client';

import {
  Button as MantineButton,
  Card as MantineCard,
  TextInput as MantineTextInput,
  Badge as MantineBadge,
  Modal as MantineModal,
  Stack as MantineStack,
  Group as MantineGroup,
  Text as MantineText,
  Title as MantineTitle,
  Box as MantineBox,
  Divider as MantineDivider,
  type ButtonProps as MantineButtonProps,
  type CardProps as MantineCardProps,
  type TextInputProps as MantineTextInputProps,
  type BadgeProps as MantineBadgeProps,
  type ModalProps as MantineModalProps,
  type StackProps as MantineStackProps,
  type GroupProps as MantineGroupProps,
  type TextProps as MantineTextProps,
  type TitleProps as MantineTitleProps,
  type BoxProps as MantineBoxProps,
  type DividerProps as MantineDividerProps,
} from '@mantine/core';
import { forwardRef } from 'react';
import type { SemanticTone } from '../../theme/semantic';
import { semanticToneToMantineColor } from '../../utils/semantic-colors';

/**
 * Semantic-aware Button
 */
export interface ButtonProps extends Omit<MantineButtonProps, 'color'> {
  tone?: SemanticTone;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ tone = 'neutral', ...props }, ref) => {
    const color = semanticToneToMantineColor(tone);
    return (
      <MantineButton
        ref={ref}
        color={color}
        variant={tone === 'neutral' ? 'default' : 'filled'}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';

/**
 * Semantic-aware Card
 */
export interface CardProps extends MantineCardProps {
  tone?: SemanticTone;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ tone = 'neutral', style, ...props }, ref) => {
    return (
      <MantineCard
        ref={ref}
        data-tone={tone}
        style={style}
        {...props}
      />
    );
  }
);
Card.displayName = 'Card';

/**
 * Semantic-aware TextInput
 */
export interface TextInputProps extends Omit<MantineTextInputProps, 'color'> {
  tone?: SemanticTone;
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(
  ({ tone = 'neutral', ...props }, ref) => {
    return (
      <MantineTextInput
        ref={ref}
        {...props}
      />
    );
  }
);
TextInput.displayName = 'TextInput';

/**
 * Semantic-aware Badge
 */
export interface BadgeProps extends Omit<MantineBadgeProps, 'color'> {
  tone?: SemanticTone;
}

export const Badge = forwardRef<HTMLDivElement, BadgeProps>(
  ({ tone = 'neutral', ...props }, ref) => {
    const color = semanticToneToMantineColor(tone);
    return (
      <MantineBadge
        ref={ref as any}
        color={color}
        variant={tone === 'neutral' ? 'outline' : 'light'}
        {...props}
      />
    );
  }
);
Badge.displayName = 'Badge';

/**
 * Modal wrapper
 */
export const Modal = MantineModal;

/**
 * Layout primitives
 */
export const Stack = MantineStack;
export const Group = MantineGroup;
export const Box = MantineBox;

/**
 * Typography
 */
export const Text = MantineText;
export const Title = MantineTitle;

/**
 * Divider
 */
export const Divider = MantineDivider;

/**
 * Reusable Card shell
 */
export { CardShell } from './card-shell';

/**
 * Reusable ColumnHeader
 */
export { ColumnHeader } from './column-header';
export { BoardLayout } from './board-layout';
export { FilterBar } from './filter-bar';
