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
 * Phase 28 (A11Y-02, A11Y-08): the account pages and the bug report form. Their error and
 * success boxes are filled in by the page script, so they are live regions (alert for errors,
 * status for success) that exist before the message does. The show-password buttons report
 * whether the password is showing, their eye icons are hidden from the reader, and every input
 * has a focus ring that is 3:1 or better against white.
 */

type Page = Parameters<AstroContainer['renderToString']>[0];

interface Case {
  name: string;
  Page: Page;
  path: string;
  source: string;
  successId: string | null;
  toggles: number;
}

const CASES: Case[] = [
  { name: 'sign-in', Page: SigninPage, path: '/auth/signin', source: 'src/pages/auth/signin.astro', successId: null, toggles: 1 },
  { name: 'sign-up', Page: SignupPage, path: '/auth/signup', source: 'src/pages/auth/signup.astro', successId: null, toggles: 2 },
  {
    name: 'forgot password',
    Page: ForgotPasswordPage,
    path: '/auth/forgot-password',
    source: 'src/pages/auth/forgot-password.astro',
    successId: 'success-message',
    toggles: 0,
  },
  {
    name: 'reset password',
    Page: ResetPasswordPage,
    path: '/auth/reset-password?token=example-token',
    source: 'src/pages/auth/reset-password.astro',
    successId: 'success-container',
    toggles: 2,
  },
  {
    name: 'bug report',
    Page: BugReportPage,
    path: '/bug-report',
    source: 'src/pages/bug-report.astro',
    successId: 'success-message',
    toggles: 0,
  },
];

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

describe.each(CASES)('$name page', ({ Page, path, source, successId, toggles }) => {
  it('makes the error box an alert that exists before any error', async () => {
    const root = await render(Page, path);
    const error = root.querySelector('#error-message');
    expect(error?.getAttribute('role')).toBe('alert');
    expect(classList(error!)).toContain('hidden');
  });

  it('makes the success box a status region', async () => {
    if (!successId) return;
    const root = await render(Page, path);
    expect(root.querySelector(`#${successId}`)?.getAttribute('role')).toBe('status');
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

  it('shows a message box before filling it, so the change is announced', () => {
    const lines = readFileSync(join(process.cwd(), source), 'utf8').split(/\r?\n/);
    const fills = lines
      .map((line, index) => ({ line: line.trim(), index }))
      .filter(({ line }) => /^(errorMessage|successMessage)\.textContent\s*=/.test(line));
    expect(fills.length).toBeGreaterThan(0);
    for (const { line, index } of fills) {
      const box = line.split('.')[0];
      expect(lines[index - 1].trim(), `${source}:${index + 1}`).toBe(`${box}.classList.remove('hidden');`);
    }
  });

  it('keeps aria-pressed in step with the password field', () => {
    if (toggles === 0) return;
    const text = readFileSync(join(process.cwd(), source), 'utf8');
    expect(text).toContain("button.setAttribute('aria-pressed', 'true')");
    expect(text).toContain("button.setAttribute('aria-pressed', 'false')");
  });
});
