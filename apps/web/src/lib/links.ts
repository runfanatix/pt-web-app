import { shareUrl } from '@pt/core';

/**
 * The address a client opens. Normally https://<site>/p/<token>. In the offline demo the app is a single file with
 * no server to answer /p/<token>, so the link is the same file with #/p/<token> on the end.
 */
export function publicLink(token: string): string {
  if (import.meta.env.VITE_DEMO === '1') return `${window.location.href.split('#')[0]}#/p/${token}`;
  return shareUrl(window.location.origin, token);
}

/** The path the app should route on: the real path, or (in the demo) the part after the #. */
export function currentPath(): string {
  if (import.meta.env.VITE_DEMO === '1') {
    const h = window.location.hash;
    return h.startsWith('#/') ? h.slice(1) : '/';
  }
  return window.location.pathname;
}
