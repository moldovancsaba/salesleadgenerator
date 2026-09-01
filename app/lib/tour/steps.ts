import type { DriveStep } from 'driver.js';
import { TOUR_SELECTOR, dataTourSelector } from './selectors';

// Issue #185 — the two real "drive the UI" transition points (open the
// Lead Detail modal to reveal steps 4-5; open the nav Drawer to reveal
// steps 6-7). See docs/ARCHITECTURE.md's onboarding-tour section for the
// full reasoning: a real .click() on the actual trigger DOM node, not a
// lifted/shared state store — driver.js's overlay only blocks real mouse
// hit-testing (pointer-events:none), never a programmatic .click().
const OVERLAY_CLOSE_SELECTOR = '.mantine-Modal-close, .mantine-Drawer-close';

function clickSelector(selector: string): void {
  document.querySelector<HTMLElement>(selector)?.click();
}

// Closes whatever the tour itself opened (Lead Detail modal, nav Drawer) —
// harmless no-op if neither is currently open. Both share this selector by
// design (Mantine's static class name is keyed by component name, not
// instance) and are never open at the same time in this tour's own
// sequencing, so querying both together is safe. Exported so
// TourProvider.tsx's onDestroyStarted teardown (Escape/Skip/Done — any way
// the tour can end) reuses this instead of a second, driftable copy.
export function closeAnyTourOpenedOverlay(): void {
  document.querySelectorAll<HTMLElement>(OVERLAY_CLOSE_SELECTOR).forEach((btn) => btn.click());
}

// A generous-but-bounded wait for driver.js's own MutationObserver-based
// element wait — covers a real modal/drawer open transition (Mantine's
// default transition duration is well under this) without leaving the tour
// hanging indefinitely if a click genuinely didn't open anything (the step
// then falls through to skipMissingElement instead).
const OPEN_TRANSITION_WAIT_MS = 1500;

export function buildTourSteps(): DriveStep[] {
  return [
    {
      element: dataTourSelector(TOUR_SELECTOR.kanbanBoard),
      popover: {
        title: 'Your pipeline',
        description: 'Leads move left to right through this board — Discovered, Qualified, Engaged, Proposal, and finally Won or Lost.',
      },
      skipMissingElement: true,
    },
    {
      element: dataTourSelector(TOUR_SELECTOR.leadCard),
      popover: {
        title: 'A lead card',
        description: 'Each card shows an ICE score, an estimated ticket size, a quality badge, and — if it has gone quiet — a rotten indicator.',
      },
      skipMissingElement: true,
    },
    {
      element: dataTourSelector(TOUR_SELECTOR.addLeadTrigger),
      popover: {
        title: 'Add a lead',
        description: "Found an organization the research agent hasn't? Add it here manually.",
        onNextClick: (_element, _step, opts) => {
          clickSelector(dataTourSelector(TOUR_SELECTOR.leadDetailOpen));
          opts.driver.moveNext();
        },
      },
      skipMissingElement: true,
    },
    {
      element: dataTourSelector(TOUR_SELECTOR.leadDetailContent),
      popover: {
        title: 'Lead detail',
        description: 'Opening a card shows its contacts, qualification, checklist, and activity history — everything about this lead in one place.',
        onPrevClick: (_element, _step, opts) => {
          closeAnyTourOpenedOverlay();
          opts.driver.movePrevious();
        },
      },
      skipMissingElement: true,
      waitForElement: OPEN_TRANSITION_WAIT_MS,
    },
    {
      element: `#${TOUR_SELECTOR.composeOutreach}`,
      popover: {
        title: 'Outreach',
        description: 'Compose and log outreach emails to this lead directly from here.',
        onNextClick: (_element, _step, opts) => {
          closeAnyTourOpenedOverlay();
          clickSelector(dataTourSelector(TOUR_SELECTOR.navHamburger));
          opts.driver.moveNext();
        },
      },
      skipMissingElement: true,
    },
    {
      element: dataTourSelector(TOUR_SELECTOR.brandSwitcher),
      popover: {
        title: 'Switch organizations',
        description: 'If you have access to more than one client, switch between them here.',
        onPrevClick: (_element, _step, opts) => {
          closeAnyTourOpenedOverlay();
          opts.driver.movePrevious();
        },
      },
      skipMissingElement: true,
      waitForElement: OPEN_TRANSITION_WAIT_MS,
    },
    {
      element: dataTourSelector(TOUR_SELECTOR.salesSettingsLink),
      popover: {
        title: 'Sales Settings',
        description: "This is where this client's ticket-size and forecast assumptions live.",
      },
      skipMissingElement: true,
    },
  ];
}
