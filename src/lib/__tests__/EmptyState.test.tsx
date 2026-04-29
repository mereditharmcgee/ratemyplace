import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import EmptyState from '../../components/ui/EmptyState';

afterEach(() => {
  cleanup();
});

describe('EmptyState', () => {
  it('renders title inside an h3 with correct classes', () => {
    const { container } = render(<EmptyState title="Nothing here" description="Try again later." />);
    const h = container.querySelector('h3');
    expect(h).toBeTruthy();
    expect(h!.textContent).toBe('Nothing here');
    expect(h!.className).toContain('text-lg');
    expect(h!.className).toContain('font-medium');
    expect(h!.className).toContain('text-gray-900');
  });

  it('renders description inside a p with correct class', () => {
    const { container } = render(<EmptyState title="Empty" description="No data available." />);
    const p = container.querySelector('p');
    expect(p).toBeTruthy();
    expect(p!.textContent).toBe('No data available.');
    expect(p!.className).toContain('text-gray-600');
  });

  it('renders an anchor with correct href and label when action is provided', () => {
    const { container } = render(
      <EmptyState
        title="Empty"
        description="Nothing."
        action={{ label: 'Go Home', href: '/home' }}
      />
    );
    const a = container.querySelector('a');
    expect(a).toBeTruthy();
    expect(a!.textContent).toBe('Go Home');
    expect((a as HTMLAnchorElement).getAttribute('href')).toBe('/home');
    expect(a!.className).toContain('bg-teal-700');
  });

  it('renders no anchor when action is omitted', () => {
    const { container } = render(<EmptyState title="Empty" description="Nothing." />);
    const a = container.querySelector('a');
    expect(a).toBeNull();
  });

  it('renders icon wrapper when icon is provided', () => {
    const TestIcon = () => <svg data-testid="test-icon" />;
    const { container } = render(
      <EmptyState title="Empty" description="Nothing." icon={<TestIcon />} />
    );
    const icon = container.querySelector('[data-testid="test-icon"]');
    expect(icon).toBeTruthy();
    const wrapper = icon!.closest('div');
    expect(wrapper?.className).toContain('text-gray-400');
  });

  it('does not render icon wrapper when icon is omitted', () => {
    const { container } = render(<EmptyState title="Empty" description="Nothing." />);
    const iconWrapper = container.querySelector('.text-gray-400.mx-auto.mb-4');
    expect(iconWrapper).toBeNull();
  });

  it('appends className to the outer wrapper', () => {
    const { container } = render(
      <EmptyState title="Empty" description="Nothing." className="py-12 my-custom" />
    );
    const wrapper = container.firstElementChild;
    expect(wrapper?.className).toContain('py-12');
    expect(wrapper?.className).toContain('my-custom');
    expect(wrapper?.className).toContain('bg-gray-50');
  });
});
