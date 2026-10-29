import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { HelpTooltip } from '../../components/reviews/HelpTooltip';

// The rating help is a disclosure (APG disclosure pattern): a button that shows and hides a
// panel of text. It is not a tooltip, which may only hold a short description and never
// takes focus. Escape and Close put focus back on the button.

const HELP = {
  description: 'An example description of what this question covers.',
  examples: {
    high: 'An example of a high answer.',
    mid: 'An example of a middle answer.',
    low: 'An example of a low answer.',
  },
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const focused = () => document.activeElement as HTMLElement | null;

function renderHelp() {
  render(
    <div>
      <HelpTooltip help={HELP} dimension="Example Dimension" />
      <button type="button">Elsewhere</button>
    </div>,
  );
  return screen.getByRole('button', { name: 'Help for Example Dimension' });
}

describe('HelpTooltip as a disclosure', () => {
  it('starts closed, with no tooltip role anywhere', () => {
    const trigger = renderHelp();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.hasAttribute('aria-controls')).toBe(false);
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
  });

  it('points aria-controls at the open panel', () => {
    const trigger = renderHelp();
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const panelId = trigger.getAttribute('aria-controls');
    expect(panelId).toBeTruthy();
    const panel = document.getElementById(panelId!);
    expect(panel?.textContent).toContain(HELP.description);
    expect(panel?.getAttribute('role')).toBeNull();
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
  });

  it('Escape closes it and returns focus to the button', () => {
    const trigger = renderHelp();
    trigger.focus();
    fireEvent.click(trigger);
    const close = screen.getByRole('button', { name: 'Close help' });
    close.focus();
    fireEvent.keyDown(close, { key: 'Escape' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText(HELP.description)).toBeNull();
    expect(focused()).toBe(trigger);
  });

  it('Close help closes it and returns focus to the button', () => {
    const trigger = renderHelp();
    fireEvent.click(trigger);
    const close = screen.getByRole('button', { name: 'Close help' });
    close.focus();
    fireEvent.click(close);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.hasAttribute('aria-controls')).toBe(false);
    expect(focused()).toBe(trigger);
  });

  it('Escape with focus elsewhere on the page closes it without moving focus', () => {
    const trigger = renderHelp();
    fireEvent.click(trigger);
    const elsewhere = screen.getByRole('button', { name: 'Elsewhere' });
    elsewhere.focus();
    fireEvent.keyDown(elsewhere, { key: 'Escape' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(focused()).toBe(elsewhere);
  });

  it('a press outside closes it', () => {
    const trigger = renderHelp();
    fireEvent.click(trigger);
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('HelpTooltip look', () => {
  it('shows a teal keyboard outline on the button and keeps a bigger hit area', () => {
    const trigger = renderHelp();
    const classes = trigger.className.split(/\s+/);
    expect(classes).toEqual(
      expect.arrayContaining([
        'rounded-sm',
        'focus-visible:outline-2',
        'focus-visible:outline-offset-2',
        'focus-visible:outline-teal-700',
        'p-1',
        '-m-1',
      ]),
    );
    expect(classes).not.toContain('focus:outline-none');
    expect(trigger.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('caps the panel width at the screen width', () => {
    const trigger = renderHelp();
    fireEvent.click(trigger);
    const panel = document.getElementById(trigger.getAttribute('aria-controls')!)!;
    expect(panel.className.split(/\s+/)).toContain('max-w-[calc(100vw-2rem)]');
  });

  it('moves the panel left when it would run past the right edge of a narrow screen', () => {
    // A 375px phone, with the help button 197px in: a 320px panel would end at 517px.
    vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(375);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 197,
      right: 517,
      top: 0,
      bottom: 0,
      width: 320,
      height: 0,
      x: 197,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    const trigger = renderHelp();
    fireEvent.click(trigger);
    const panel = document.getElementById(trigger.getAttribute('aria-controls')!)!;
    // 517 - (375 - 16) = 158px to the left, so it ends 16px from the edge.
    expect(panel.style.left).toBe('-158px');
    // The arrow moves the other way, so it still points at the button.
    const arrow = panel.firstElementChild as HTMLElement;
    expect(arrow.style.left).toBe('170px');
  });

  it('leaves the panel where it is when it fits', () => {
    const trigger = renderHelp();
    fireEvent.click(trigger);
    const panel = document.getElementById(trigger.getAttribute('aria-controls')!)!;
    expect(panel.style.left).toBe('');
  });
});
