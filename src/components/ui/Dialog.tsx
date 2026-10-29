import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode, type RefObject } from 'react';

/**
 * The one modal dialog (WAI-ARIA APG modal dialog pattern) on a native <dialog>.
 *
 * The parent mounts it to open it and unmounts it to close it, as in
 * `{show && <Dialog ...>}`. onClose is a request: the parent closes the dialog by
 * unmounting it, and onClose is called at most once per mount.
 *
 * - Named by exactly one of labelledBy (an element id) or ariaLabel.
 * - On open, focus goes to initialFocusRef, else the first focusable element, else the
 *   dialog itself.
 * - Escape, the native cancel event and a click on the backdrop each ask to close.
 * - Tab and Shift+Tab wrap inside the dialog. showModal already makes the page inert;
 *   the explicit wrap keeps focus out of the browser chrome, and works where showModal
 *   is missing.
 * - On close, focus returns to the element that opened it. If that element is gone,
 *   returnFocusFallback() is used, then the page h1, then #main-content.
 *
 * It only ever mounts after a press, never during server rendering, so the effects can
 * use the DOM directly.
 */

type DialogName = { labelledBy: string; ariaLabel?: never } | { ariaLabel: string; labelledBy?: never };

export type DialogProps = DialogName & {
  onClose: () => void;
  describedBy?: string;
  initialFocusRef?: RefObject<HTMLElement>;
  returnFocusFallback?: () => HTMLElement | null;
  /** Classes for the <dialog> box. Replaces the default modal look when given. */
  className?: string;
  children: ReactNode;
};

/** The centered modal box. The panel inside owns its own padding, radius and scrolling. */
export const DIALOG_CLASS =
  'm-auto w-[calc(100%-2rem)] max-w-lg max-h-[calc(100dvh-2rem)] bg-transparent p-0 overflow-visible backdrop:bg-black/50';

const FOCUSABLE = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'summary',
  'iframe',
  '[contenteditable="true"]',
  '[tabindex]',
].join(', ');

export function focusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.getAttribute('tabindex') !== '-1' && !el.closest('[hidden], [inert]'),
  );
}

function tryFocus(el: HTMLElement | null | undefined): boolean {
  if (!el || !el.isConnected || el === document.body) return false;
  el.focus();
  return document.activeElement === el;
}

function restoreFocus(opener: HTMLElement | null, fallback: (() => HTMLElement | null) | undefined): void {
  if (tryFocus(opener)) return;
  if (tryFocus(fallback?.())) return;
  const heading = document.querySelector<HTMLElement>('main h1') ?? document.querySelector<HTMLElement>('h1');
  if (heading) {
    if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
    if (tryFocus(heading)) return;
  }
  tryFocus(document.getElementById('main-content'));
}

export default function Dialog({
  onClose,
  labelledBy,
  ariaLabel,
  describedBy,
  initialFocusRef,
  returnFocusFallback,
  className,
  children,
}: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  // Read during the first render, before any child effect can move focus.
  const [opener] = useState<HTMLElement | null>(() =>
    typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null),
  );
  // The latest callbacks, so the mount effect below runs once however often the parent renders.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const fallbackRef = useRef(returnFocusFallback);
  fallbackRef.current = returnFocusFallback;
  const closeRequested = useRef(false);
  const pressStartedInside = useRef(false);

  const requestClose = () => {
    if (closeRequested.current) return;
    closeRequested.current = true;
    onCloseRef.current();
  };

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }

    const initial = initialFocusRef?.current ?? focusableElements(dialog)[0] ?? dialog;
    initial.focus();

    const onCancel = (event: Event) => {
      event.preventDefault();
      requestClose();
    };
    dialog.addEventListener('cancel', onCancel);

    return () => {
      dialog.removeEventListener('cancel', onCancel);
      if (typeof dialog.close === 'function') {
        if (dialog.open) dialog.close();
      } else {
        dialog.removeAttribute('open');
      }
      restoreFocus(opener, fallbackRef.current);
    };
    // Mount and unmount only: the parent opens by mounting and closes by unmounting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.defaultPrevented) return;
    const dialog = event.currentTarget;

    if (event.key === 'Escape') {
      event.preventDefault();
      requestClose();
      return;
    }

    if (event.key !== 'Tab') return;
    const items = focusableElements(dialog);
    if (items.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    const outside = !active || active === dialog || !dialog.contains(active);
    if (event.shiftKey && (active === first || outside)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || outside)) {
      event.preventDefault();
      first.focus();
    }
  };

  // A click whose target is the <dialog> itself landed on the backdrop: the panel inside
  // covers the whole box. A press that started inside the panel (selecting text, say) and
  // ended outside it is not a backdrop click.
  const onMouseDown = (event: MouseEvent<HTMLDialogElement>) => {
    pressStartedInside.current = event.target !== event.currentTarget;
  };

  const onClick = (event: MouseEvent<HTMLDialogElement>) => {
    const startedInside = pressStartedInside.current;
    pressStartedInside.current = false;
    if (event.target === event.currentTarget && !startedInside) requestClose();
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={labelledBy}
      aria-label={ariaLabel}
      aria-describedby={describedBy}
      tabIndex={-1}
      className={className ?? DIALOG_CLASS}
      onKeyDown={onKeyDown}
      onMouseDown={onMouseDown}
      onClick={onClick}
    >
      {children}
    </dialog>
  );
}
