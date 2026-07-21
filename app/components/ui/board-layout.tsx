import { Box, Group, Button } from '@mantine/core';
import type { ReactNode } from 'react';
import { tokens } from '../../theme/tokens';
import { breakpoints } from '../../theme/breakpoints';

type BoardLayoutProps = {
  mode: 'mobile-portrait' | 'mobile-landscape' | 'tablet-portrait' | 'tablet-landscape' | 'desktop';
  showAdvancedControls: boolean;
  sortControls?: ReactNode;
  boardContent: ReactNode;
  boardClassName?: string;
  boardStyle?: Record<string, any>;
  boardRef?: React.Ref<HTMLDivElement>;
};

export function BoardLayout({
  mode,
  showAdvancedControls,
  sortControls,
  boardContent,
  boardClassName,
  boardStyle,
  boardRef,
}: BoardLayoutProps) {
  return (
    <Box>
      {showAdvancedControls && sortControls}

      <Box
        ref={boardRef}
        className={`kanban-board kanban-board--${mode}${boardClassName ? ` ${boardClassName}` : ''}`}
        style={{
          flex: '1 1 auto',
          height: 'auto',
          minHeight: 0,
          ...boardStyle,
        }}
      >
        {boardContent}
      </Box>
    </Box>
  );
}
