/**
 * Tiny wrapper around `navigator.vibrate` for tactile feedback in the PWA.
 *
 * Designed for field use where marketers may not feel taps registering due to
 * gloves or quick interactions. Honors the user's "reduced motion" preference
 * to keep things accessible.
 */

function reducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function vibrate(pattern: number | number[]): void {
  if (reducedMotion()) return;
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  try {
    navigator.vibrate(pattern);
  } catch {
    // Some browsers throw if a user gesture hasn't happened yet; ignore.
  }
}

export const haptics = {
  /** Light tap — confirm a chip / button press */
  tap: () => vibrate(8),
  /** Medium tap — used on primary actions (Save, Submit) */
  press: () => vibrate(16),
  /** Two short pulses — success */
  success: () => vibrate([10, 40, 10]),
  /** Long pulse — error / blocked */
  error: () => vibrate(80),
  /** Gentle hum — used as a "queued for sync" notification */
  queued: () => vibrate([6, 30, 6, 30, 6]),
};
