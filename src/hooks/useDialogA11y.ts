import { useEffect, useRef } from 'react';

/**
 * Aksesibilitas dialog (pola ARIA modal): saat dialog dibuka fokus dipindah
 * ke dalamnya, Tab/Shift+Tab dipagarkan di dalam dialog, dan saat ditutup
 * fokus dikembalikan ke elemen pemicu.
 *
 * Pasangkan dengan role="dialog" + aria-modal="true" + aria-labelledby pada
 * elemen kontainer, dan berikan tabIndex={-1} agar kontainer bisa menerima
 * fokus awal.
 */
export function useDialogA11y<T extends HTMLElement>(open: boolean) {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    if (!open) return;
    const dialog = ref.current;
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    dialog?.focus({ preventScroll: true });

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !dialog) return;
      const focusables = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          [
            'a[href]',
            'button:not([disabled])',
            'input:not([disabled])',
            'select:not([disabled])',
            'textarea:not([disabled])',
            '[tabindex]:not([tabindex="-1"])',
          ].join(', ')
        )
      );
      if (focusables.length === 0) {
        e.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === dialog)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || active === dialog)) {
        e.preventDefault();
        first.focus();
      }
    };

    // Capture phase supaya trap berjalan sebelum handler lain.
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      previouslyFocused?.focus({ preventScroll: true });
    };
  }, [open]);

  return ref;
}
