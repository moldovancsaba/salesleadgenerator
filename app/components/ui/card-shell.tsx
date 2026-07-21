import { Card } from '@mantine/core';
import type { ReactNode } from 'react';

type CardShellProps = {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  withBorder?: boolean;
  radius?: string | number;
  style?: Record<string, any>;
};

export function CardShell({ children, className, onClick, withBorder = true, radius = 'md', style }: CardShellProps) {
  return (
    <Card
      padding={0}
      radius={radius}
      withBorder={withBorder}
      className={className}
      style={{
        cursor: onClick ? 'pointer' : 'default',
        transition: 'transform 0.1s, box-shadow 0.1s',
        ...style,
      }}
      onClick={onClick}
    >
      {children}
    </Card>
  );
}
