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
import { forwardRef, CSSProperties } from 'react';
import type { SemanticTone } from '../../theme/semantic';

/**
 * Semantic-aware Button
 * Maps tone prop to Mantine color
 */
export interface ButtonProps extends Omit<MantineButtonProps, 'color'> {
  tone?: SemanticTone;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ tone = 'neutral', ...props }, ref) => {
    return (
      <MantineButton
        ref={ref}
        color={tone}
        variant={tone === 'neutral' ? 'default' : 'filled'}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';

/**
 * Semantic-aware Card
 * Applies tone via data attribute for CSS targeting
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
 * Maps tone to focus color
 */
export interface TextInputProps extends MantineTextInputProps {
  tone?: SemanticTone;
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(
  ({ tone = 'neutral', ...props }, ref) => {
    return (
      <MantineTextInput
        ref={ref}
        classNames={{
          input: tone === 'neutral' ? '' : '',
        }}
        {...props}
      />
    );
  }
);
TextInput.displayName = 'TextInput';

/**
 * Semantic-aware Badge
 * Maps tone to color
 */
export interface BadgeProps extends Omit<MantineBadgeProps, 'color'> {
  tone?: SemanticTone;
}

export const Badge = forwardRef<HTMLDivElement, BadgeProps>(
  ({ tone = 'neutral', ...props }, ref) => {
    return (
      <MantineBadge
        ref={ref as any}
        color={tone}
        variant={tone === 'neutral' ? 'outline' : 'light'}
        {...props}
      />
    );
  }
);
Badge.displayName = 'Badge';

/**
 * Modal wrapper
 * Consistent styling across app
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
