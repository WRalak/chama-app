/**
 * Step-up re-authentication for the staff portal. When the API answers REAUTH_REQUIRED, api()
 * asks the dialog mounted by the portal shell; if the person confirms, the request is retried once.
 */
type Handler = () => Promise<boolean>;
let handler: Handler | null = null;
let pending: Promise<boolean> | null = null;

export function registerReauthHandler(h: Handler | null) {
  handler = h;
}

/** Resolves true once the person has re-authenticated, false if they cancelled (or no dialog exists). */
export function requestReauth(): Promise<boolean> {
  if (!handler) return Promise.resolve(false);
  // Several requests may need it at once; ask only once.
  pending ??= handler().finally(() => {
    pending = null;
  });
  return pending;
}
