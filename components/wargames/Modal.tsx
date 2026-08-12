'use client';

/**
 * A dialog over the whole console.
 *
 * The system form has thirty-odd fields and does not fit a 348 px column
 * without becoming a scroll within a scroll. It gets the screen instead.
 *
 * Deliberately not a <dialog>: showModal() moves focus and traps it against the
 * top layer, which fights the map underneath in ways that are not worth the
 * ceremony here. Escape and a backdrop click are the two ways out, and both are
 * wired below.
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export function Modal({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  // Rendered on the client only: the portal needs a document, and the server
  // has none.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    // Capture, so Escape closes the dialog rather than reaching the map's own
    // handler and quietly resetting the tool behind it.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  /* Focus once, on open, and never again.
     This deliberately has no dependencies. Sharing the effect above meant it
     re-ran whenever `onClose` changed identity — and callers pass an inline
     arrow, so that was every render, so it was every keystroke: type one
     character anywhere in the system form and focus was dragged back to the
     first field. `mounted` is in the condition rather than the deps because the
     portal does not exist on the first pass. */
  const focused = useRef(false);
  useEffect(() => {
    if (!mounted || focused.current) return;
    focused.current = true;
    panelRef.current?.querySelector<HTMLElement>('input, select, textarea, button')?.focus();
  });

  if (!mounted) return null;

  /* Portalled to <body> rather than left where it is declared. The console
     panel carries a backdrop-filter, and any filtered ancestor becomes the
     containing block for position:fixed descendants — so a "fixed" overlay
     inside it is quietly clipped to a 384 px column. */
  return createPortal(
    <div
      className="wg-modal-veil"
      onMouseDown={(e) => {
        // Only a press that both starts and ends on the veil closes it, so a
        // drag that overshoots a text selection does not throw the form away.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="wg-modal" role="dialog" aria-modal="true" aria-label={title} ref={panelRef}>
        <header className="wg-modal-head">
          <h3>{title}</h3>
          <button className="wg-modal-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <div className="wg-modal-body">{children}</div>
        {footer && <footer className="wg-modal-foot">{footer}</footer>}
      </div>
    </div>,
    document.body
  );
}
