import { afterEach, describe, expect, it, vi } from 'vitest';
import { useRef, useState, type ReactNode } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import Dialog from '../../components/ui/Dialog';

// A11Y-06: one modal dialog for the whole site (plan pattern P6), on a native <dialog>.
// happy-dom's showModal only sets `open` and never fires `cancel` on Escape, so the focus
// trap and the Escape handler are explicit, and these tests can see them.

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const focused = () => document.activeElement as HTMLElement | null;

function Panel({ children }: { children?: ReactNode }) {
  return (
    <div data-testid="panel" className="relative bg-white rounded-xl shadow-xl p-6">
      <h2 id="dlg-title">Example dialog</h2>
      <p id="dlg-intro">An example description.</p>
      {children}
    </div>
  );
}

describe('Dialog semantics', () => {
  it('renders an open dialog named by labelledBy and described by describedBy', () => {
    render(
      <Dialog labelledBy="dlg-title" describedBy="dlg-intro" onClose={() => {}}>
        <Panel>
          <button type="button">First</button>
        </Panel>
      </Dialog>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Example dialog' });
    expect(dialog.tagName).toBe('DIALOG');
    expect(dialog.hasAttribute('open')).toBe(true);
    expect(dialog.getAttribute('aria-describedby')).toBe('dlg-intro');
  });

  it('can be named by ariaLabel instead', () => {
    render(
      <Dialog ariaLabel="Example document" onClose={() => {}}>
        <button type="button">Close</button>
      </Dialog>,
    );
    expect(screen.getByRole('dialog', { name: 'Example document' })).toBeTruthy();
  });

  it('opens without showModal by setting the open attribute', () => {
    const proto = HTMLDialogElement.prototype as unknown as { showModal?: () => void };
    const original = proto.showModal;
    proto.showModal = undefined;
    try {
      render(
        <Dialog ariaLabel="Example document" onClose={() => {}}>
          <button type="button">Close</button>
        </Dialog>,
      );
      expect(screen.getByRole('dialog').hasAttribute('open')).toBe(true);
    } finally {
      proto.showModal = original;
    }
  });

  it('keeps the current modal look by default, and takes a className in its place', () => {
    const { unmount } = render(
      <Dialog ariaLabel="Example document" onClose={() => {}}>
        <button type="button">Close</button>
      </Dialog>,
    );
    const classes = screen.getByRole('dialog').className.split(/\s+/);
    expect(classes).toEqual(
      expect.arrayContaining(['m-auto', 'max-w-lg', 'bg-transparent', 'p-0', 'overflow-visible', 'backdrop:bg-black/50']),
    );
    unmount();

    render(
      <Dialog ariaLabel="Example document" className="full-screen-example" onClose={() => {}}>
        <button type="button">Close</button>
      </Dialog>,
    );
    expect(screen.getByRole('dialog').className).toBe('full-screen-example');
  });
});

describe('Dialog initial focus', () => {
  it('goes to initialFocusRef when given', () => {
    function WithInitial() {
      const ref = useRef<HTMLInputElement>(null);
      return (
        <Dialog labelledBy="dlg-title" initialFocusRef={ref} onClose={() => {}}>
          <Panel>
            <button type="button">First</button>
            <input ref={ref} aria-label="Example field" />
          </Panel>
        </Dialog>
      );
    }
    render(<WithInitial />);
    expect(focused()).toBe(screen.getByLabelText('Example field'));
  });

  it('otherwise goes to the first focusable element', () => {
    render(
      <Dialog labelledBy="dlg-title" onClose={() => {}}>
        <Panel>
          <button type="button" disabled>
            Disabled
          </button>
          <button type="button">First</button>
          <button type="button">Second</button>
        </Panel>
      </Dialog>,
    );
    expect(focused()).toBe(screen.getByRole('button', { name: 'First' }));
  });

  it('otherwise goes to the dialog itself', () => {
    render(
      <Dialog labelledBy="dlg-title" onClose={() => {}}>
        <Panel />
      </Dialog>,
    );
    const dialog = screen.getByRole('dialog');
    expect(focused()).toBe(dialog);
    expect(dialog.getAttribute('tabindex')).toBe('-1');
  });
});

describe('Dialog focus trap', () => {
  function Trap() {
    return (
      <Dialog labelledBy="dlg-title" onClose={() => {}}>
        <Panel>
          <button type="button">First</button>
          <a href="/example">Middle link</a>
          <button type="button">Last</button>
          <button type="button" disabled>
            Disabled last
          </button>
        </Panel>
      </Dialog>
    );
  }

  it('Tab on the last focusable element wraps to the first', () => {
    render(<Trap />);
    const first = screen.getByRole('button', { name: 'First' });
    const last = screen.getByRole('button', { name: 'Last' });
    last.focus();
    // fireEvent returns false when the handler prevented the default move.
    expect(fireEvent.keyDown(last, { key: 'Tab' })).toBe(false);
    expect(focused()).toBe(first);
  });

  it('Shift+Tab on the first focusable element wraps to the last', () => {
    render(<Trap />);
    const first = screen.getByRole('button', { name: 'First' });
    const last = screen.getByRole('button', { name: 'Last' });
    first.focus();
    expect(fireEvent.keyDown(first, { key: 'Tab', shiftKey: true })).toBe(false);
    expect(focused()).toBe(last);
  });

  it('leaves Tab alone in the middle, so the browser moves focus as usual', () => {
    render(<Trap />);
    const middle = screen.getByRole('link', { name: 'Middle link' });
    middle.focus();
    expect(fireEvent.keyDown(middle, { key: 'Tab' })).toBe(true);
    expect(fireEvent.keyDown(middle, { key: 'Tab', shiftKey: true })).toBe(true);
    expect(focused()).toBe(middle);
  });

  it('keeps Tab inside when there is nothing focusable', () => {
    render(
      <Dialog labelledBy="dlg-title" onClose={() => {}}>
        <Panel />
      </Dialog>,
    );
    const dialog = screen.getByRole('dialog');
    expect(fireEvent.keyDown(dialog, { key: 'Tab' })).toBe(false);
    expect(focused()).toBe(dialog);
  });
});

describe('Dialog close paths', () => {
  function Closable({ onClose }: { onClose: () => void }) {
    return (
      <Dialog labelledBy="dlg-title" onClose={onClose}>
        <Panel>
          <button type="button">First</button>
        </Panel>
      </Dialog>
    );
  }

  it('Escape calls onClose once', () => {
    const onClose = vi.fn();
    render(<Closable onClose={onClose} />);
    const first = screen.getByRole('button', { name: 'First' });
    fireEvent.keyDown(first, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    // A browser that also fires cancel for the same key press does not close twice.
    screen.getByRole('dialog').dispatchEvent(new Event('cancel', { cancelable: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a cancel event calls onClose once and is default-prevented', () => {
    const onClose = vi.fn();
    render(<Closable onClose={onClose} />);
    const event = new Event('cancel', { cancelable: true });
    screen.getByRole('dialog').dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a click on the dialog element (the backdrop) closes it, and a click inside the panel does not', () => {
    const onClose = vi.fn();
    render(<Closable onClose={onClose} />);
    fireEvent.click(screen.getByTestId('panel'));
    fireEvent.click(screen.getByRole('button', { name: 'First' }));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a press that starts inside the panel and ends on the backdrop does not close it', () => {
    const onClose = vi.fn();
    render(<Closable onClose={onClose} />);
    fireEvent.mouseDown(screen.getByTestId('panel'));
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('other keys do nothing', () => {
    const onClose = vi.fn();
    render(<Closable onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole('button', { name: 'First' }), { key: 'Enter' });
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('Dialog focus restoration', () => {
  /** A page with a heading, an opener and a fallback target; the opener can go away on close. */
  function Page({
    removeOpenerOnClose = false,
    withFallback = false,
    fallbackReturnsNull = false,
    withHeading = true,
    withTriggerRef = false,
  }: {
    removeOpenerOnClose?: boolean;
    withFallback?: boolean;
    fallbackReturnsNull?: boolean;
    withHeading?: boolean;
    withTriggerRef?: boolean;
  }) {
    const [open, setOpen] = useState(false);
    const [openerShown, setOpenerShown] = useState(true);
    const fallbackRef = useRef<HTMLButtonElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    return (
      <main id="main-content" tabIndex={-1}>
        {withHeading && <h1>Example page</h1>}
        {openerShown && (
          <button type="button" ref={triggerRef} onClick={() => setOpen(true)}>
            Open
          </button>
        )}
        <button type="button" ref={fallbackRef}>
          Fallback
        </button>
        {open && (
          <Dialog
            labelledBy="dlg-title"
            onClose={() => {
              setOpen(false);
              if (removeOpenerOnClose) setOpenerShown(false);
            }}
            returnFocusRef={withTriggerRef ? triggerRef : undefined}
            returnFocusFallback={
              withFallback ? () => (fallbackReturnsNull ? null : fallbackRef.current) : undefined
            }
          >
            <Panel>
              <button type="button">Inside</button>
            </Panel>
          </Dialog>
        )}
      </main>
    );
  }

  function openFromKeyboard() {
    const opener = screen.getByRole('button', { name: 'Open' });
    opener.focus();
    fireEvent.click(opener);
    expect(focused()).toBe(screen.getByRole('button', { name: 'Inside' }));
  }

  const pressEscape = () => fireEvent.keyDown(focused()!, { key: 'Escape' });

  it('returns focus to the opener', () => {
    render(<Page />);
    openFromKeyboard();
    pressEscape();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(focused()).toBe(screen.getByRole('button', { name: 'Open' }));
  });

  it('with the opener gone, goes to returnFocusFallback()', () => {
    render(<Page removeOpenerOnClose withFallback />);
    openFromKeyboard();
    pressEscape();
    expect(screen.queryByRole('button', { name: 'Open' })).toBeNull();
    expect(focused()).toBe(screen.getByRole('button', { name: 'Fallback' }));
  });

  it('with no opener and no fallback element, goes to the page h1, made focusable', () => {
    render(<Page removeOpenerOnClose withFallback fallbackReturnsNull />);
    openFromKeyboard();
    pressEscape();
    const heading = screen.getByRole('heading', { level: 1 });
    expect(focused()).toBe(heading);
    expect(heading.getAttribute('tabindex')).toBe('-1');
  });

  it('with no h1 either, goes to #main-content', () => {
    render(<Page removeOpenerOnClose withHeading={false} />);
    openFromKeyboard();
    pressEscape();
    expect(focused()?.id).toBe('main-content');
  });

  /** Safari, and Firefox on macOS, do not focus a button when it is clicked or tapped. */
  function openByClickWithoutFocus() {
    expect(focused()).toBe(document.body);
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(focused()).toBe(screen.getByRole('button', { name: 'Inside' }));
  }

  it('opened by a click that did not focus its button, returns focus to returnFocusRef', () => {
    render(<Page withTriggerRef withFallback />);
    openByClickWithoutFocus();
    pressEscape();
    expect(focused()).toBe(screen.getByRole('button', { name: 'Open' }));
  });

  it('opened with nothing focused and nowhere to return, leaves the page heading alone', () => {
    render(<Page />);
    const heading = screen.getByRole('heading', { level: 1 });
    openByClickWithoutFocus();
    pressEscape();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(focused()).not.toBe(heading);
    expect(heading.hasAttribute('tabindex')).toBe(false);
    expect(focused()?.id).not.toBe('main-content');
  });

  it('a close the browser makes itself still reaches onClose, once', () => {
    const onClose = vi.fn();
    render(
      <Dialog labelledBy="dlg-title" onClose={onClose}>
        <Panel />
      </Dialog>,
    );
    const dialog = screen.getByRole('dialog');
    dialog.dispatchEvent(new Event('close'));
    dialog.dispatchEvent(new Event('close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes the native dialog on unmount', () => {
    const close = vi.spyOn(HTMLDialogElement.prototype, 'close');
    render(<Page />);
    openFromKeyboard();
    const dialog = screen.getByRole('dialog') as HTMLDialogElement;
    pressEscape();
    expect(close).toHaveBeenCalled();
    expect(dialog.open).toBe(false);
  });
});
