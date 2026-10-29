import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import SigninPage from '../../pages/auth/signin.astro';
import SignupPage from '../../pages/auth/signup.astro';
import ForgotPasswordPage from '../../pages/auth/forgot-password.astro';
import ResetPasswordPage from '../../pages/auth/reset-password.astro';
import BugReportPage from '../../pages/bug-report.astro';

/**
 * Phase 28 (A11Y-02, A11Y-05, A11Y-08): the account pages and the bug report form.
 *
 * - Error boxes, and a success message that appears beside a form that stays, are live
 *   regions (alert for errors, status for success) that are on the page, empty and collapsed,
 *   before any message. The script writes the message into them and empties them again; it
 *   never shows them from display:none, which would not be a region the reader already had.
 * - A success that replaces the form takes focus instead, with no live role, so it is read
 *   once (P3 rule 1).
 * - The submit button disables itself during the request, which drops focus to the page, so
 *   the script gives focus back to it (P3 rule 3).
 * - The show-password buttons report whether the password is showing, their eye icons are
 *   hidden from the reader, and every input has a focus ring 3:1 or better against white.
 */

type Page = Parameters<AstroContainer['renderToString']>[0];

interface Case {
  name: string;
  Page: Page;
  path: string;
  source: string;
  /** A success message beside a form that stays: a status region. */
  statusId: string | null;
  /** A success panel that replaces the form, and its script variable: it takes focus. */
  panel: { id: string; variable: string } | null;
  toggles: number;
}

const CASES: Case[] = [
  {
    name: 'sign-in',
    Page: SigninPage,
    path: '/auth/signin',
    source: 'src/pages/auth/signin.astro',
    statusId: null,
    panel: null,
    toggles: 1,
  },
  {
    name: 'sign-up',
    Page: SignupPage,
    path: '/auth/signup',
    source: 'src/pages/auth/signup.astro',
    statusId: null,
    panel: null,
    toggles: 2,
  },
  {
    name: 'forgot password',
    Page: ForgotPasswordPage,
    path: '/auth/forgot-password',
    source: 'src/pages/auth/forgot-password.astro',
    statusId: 'success-message',
    panel: null,
    toggles: 0,
  },
  {
    name: 'reset password',
    Page: ResetPasswordPage,
    path: '/auth/reset-password?token=example-token',
    source: 'src/pages/auth/reset-password.astro',
    statusId: null,
    panel: { id: 'success-container', variable: 'successContainer' },
    toggles: 2,
  },
  {
    name: 'bug report',
    Page: BugReportPage,
    path: '/bug-report',
    source: 'src/pages/bug-report.astro',
    statusId: null,
    panel: { id: 'success-message', variable: 'successMessage' },
    toggles: 0,
  },
];

/** Collapsed while empty, so an always-present box takes no room until it has a message. */
const EMPTY_COLLAPSE = ['empty:p-0', 'empty:border-0', 'empty:mb-0'];

/** The submit handler's source: from the listener to the end of the script. */
function submitHandler(source: string): string {
  const text = readFileSync(join(process.cwd(), source), 'utf8');
  const start = text.indexOf("addEventListener('submit'");
  expect(start, `${source} has no submit handler`).toBeGreaterThan(-1);
  return text.slice(start, text.indexOf('</script>', start));
}

async function render(Page: Page, path: string): Promise<HTMLElement> {
  const container = await AstroContainer.create();
  const html = await container.renderToString(Page, {
    locals: { user: null, session: null } as unknown as App.Locals,
    request: new Request(`https://ratemyplace.org${path}`),
    partial: false,
  });
  const match = html.match(/<main[^>]*>([\s\S]*?)<\/main>/);
  if (!match) throw new Error('Rendered page is missing <main>');
  const root = document.createElement('div');
  root.innerHTML = match[1];
  return root;
}

function classList(el: Element): string[] {
  return (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
}

describe.each(CASES)('$name page', ({ Page, path, source, statusId, panel, toggles }) => {
  it('makes the error box an alert that is on the page, empty and collapsed, before any error', async () => {
    const root = await render(Page, path);
    const error = root.querySelector('#error-message');
    expect(error?.getAttribute('role')).toBe('alert');
    expect(error?.innerHTML).toBe('');
    expect(classList(error!)).not.toContain('hidden');
    expect(classList(error!)).toEqual(expect.arrayContaining(EMPTY_COLLAPSE));
  });

  it('makes a success message beside the form a status region that is there before it', async () => {
    if (!statusId) return;
    const root = await render(Page, path);
    const status = root.querySelector(`#${statusId}`);
    expect(status?.getAttribute('role')).toBe('status');
    expect(status?.innerHTML).toBe('');
    expect(classList(status!)).not.toContain('hidden');
    expect(classList(status!)).toEqual(expect.arrayContaining(EMPTY_COLLAPSE));
  });

  it('makes a success panel that replaces the form take focus, with no live role', async () => {
    if (!panel) return;
    const root = await render(Page, path);
    const box = root.querySelector(`#${panel.id}`);
    expect(box?.getAttribute('tabindex')).toBe('-1');
    expect(box?.hasAttribute('role')).toBe(false);
    expect(box?.hasAttribute('aria-live')).toBe(false);
    for (const icon of Array.from(box!.querySelectorAll('svg'))) {
      expect(icon.getAttribute('aria-hidden')).toBe('true');
    }
    const handler = submitHandler(source);
    const shown = handler.indexOf(`${panel.variable}.classList.remove('hidden')`);
    const focusedAt = handler.indexOf(`${panel.variable}.focus()`);
    expect(shown).toBeGreaterThan(-1);
    expect(focusedAt).toBeGreaterThan(shown);
  });

  it('gives focus back to the submit button once it is enabled again, if nothing else has it', () => {
    const handler = submitHandler(source);
    const finallyBlock = handler.slice(handler.indexOf('finally {'));
    const enabled = finallyBlock.indexOf('button.disabled = false;');
    const refocus = finallyBlock.indexOf(
      'if (!document.activeElement || document.activeElement === document.body) button.focus();',
    );
    expect(enabled).toBeGreaterThan(-1);
    expect(refocus).toBeGreaterThan(enabled);
  });

  it('reports the show-password state and hides the eye icons', async () => {
    const root = await render(Page, path);
    const buttons = Array.from(root.querySelectorAll('.toggle-password'));
    expect(buttons).toHaveLength(toggles);
    for (const button of buttons) {
      expect(button.getAttribute('type')).toBe('button');
      expect(button.getAttribute('aria-label')).toBe('Toggle password visibility');
      expect(button.getAttribute('aria-pressed')).toBe('false');
      const icons = Array.from(button.querySelectorAll('svg'));
      expect(icons).toHaveLength(2);
      for (const icon of icons) expect(icon.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('gives every focusable control a teal-700 ring and no low-contrast ring', async () => {
    const root = await render(Page, path);
    for (const el of Array.from(root.querySelectorAll('[class]'))) {
      const classes = classList(el);
      expect(classes, el.outerHTML.slice(0, 120)).not.toContain('focus:ring-teal-500');
      expect(classes, el.outerHTML.slice(0, 120)).not.toContain('focus:ring-teal-400');
    }
    const inputs = Array.from(root.querySelectorAll('input:not([type="hidden"]), textarea, select'));
    expect(inputs.length).toBeGreaterThan(0);
    for (const input of inputs) {
      const classes = classList(input);
      if (!classes.includes('focus:outline-none')) continue;
      expect(classes, input.outerHTML.slice(0, 120)).toEqual(expect.arrayContaining(['focus:ring-2', 'focus:ring-teal-700']));
    }
  });

  it('writes messages into the live boxes and never hides or shows them', () => {
    const handler = submitHandler(source);
    expect(handler).toContain("errorMessage.textContent = '';");
    expect(handler).not.toMatch(/errorMessage\.classList/);
    if (statusId) {
      expect(handler).toContain("successMessage.textContent = '';");
      expect(handler).not.toMatch(/successMessage\.classList/);
    }
  });

  it('keeps aria-pressed in step with the password field', () => {
    if (toggles === 0) return;
    const text = readFileSync(join(process.cwd(), source), 'utf8');
    expect(text).toContain("button.setAttribute('aria-pressed', 'true')");
    expect(text).toContain("button.setAttribute('aria-pressed', 'false')");
  });
});
