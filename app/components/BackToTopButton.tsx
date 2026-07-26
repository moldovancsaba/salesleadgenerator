'use client';

import { Affix, Transition, ActionIcon } from '@mantine/core';
import { useWindowScroll } from '@mantine/hooks';
import { IconArrowUp } from '@tabler/icons-react';

// Shown after scrolling this far down from the top of the page — a small
// threshold so it doesn't flicker in on a barely-scrolled page, but well
// short of a full screen height so it appears quickly on mobile.
const SCROLL_THRESHOLD = 250;

// Mounted once, globally (app/layout.tsx), rather than per-page — every
// view in this app relies on ordinary document/window scroll (no page has
// its own overflow-y scroll container), so a single instance covers every
// view the same way. zIndex sits above the sticky header (100, layout.tsx)
// but below Mantine's own Modal/Drawer default (200) — this app has no
// overflow-locked page while one of those is open that would need this
// button hidden underneath it.
export function BackToTopButton() {
  const [scroll, scrollTo] = useWindowScroll();

  return (
    <Affix position={{ bottom: 20, right: 20 }} zIndex={150}>
      <Transition transition="slide-up" mounted={scroll.y > SCROLL_THRESHOLD}>
        {(transitionStyles) => (
          <ActionIcon
            size={48}
            radius="xl"
            variant="filled"
            color="dark"
            style={transitionStyles}
            onClick={() => scrollTo({ y: 0 })}
            aria-label="Back to top"
          >
            <IconArrowUp size={22} />
          </ActionIcon>
        )}
      </Transition>
    </Affix>
  );
}
