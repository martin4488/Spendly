/**
 * bootSignal.ts — resolves once `get_boot_data` has answered (or failed).
 *
 * Background work that isn't needed for the first screen (AppShell's data
 * prefetch for the other tabs) waits on this, so it doesn't share the network
 * with the one request the dashboard is waiting for. A module-level promise
 * rather than React state: nothing should re-render because of it.
 */

let resolveBoot: () => void = () => {};

export const bootSettled = new Promise<void>(resolve => { resolveBoot = resolve; });

export function markBootSettled(): void {
  resolveBoot();
}
