import { useQueryClient } from '@tanstack/react-query';
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { AuthResponse, AuthUser, MeResponse } from '@chamahub/shared';
import { api, loadSession, saveTokens, setSignedOutHandler } from './api';

type Status = 'loading' | 'signedOut' | 'unverified' | 'signedIn';

interface AuthState {
  status: Status;
  user: AuthUser | null;
  signIn: (phone: string, password: string) => Promise<void>;
  signUp: (input: { fullName: string; phone: string; email?: string; password: string }) => Promise<void>;
  verifyPhone: (code: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<Status>('loading');

  const apply = useCallback((u: AuthUser | null) => {
    setUser(u);
    setStatus(!u ? 'signedOut' : u.phoneVerified ? 'signedIn' : 'unverified');
  }, []);

  const signedOut = useCallback(() => {
    qc.clear();
    apply(null);
  }, [qc, apply]);

  useEffect(() => {
    setSignedOutHandler(signedOut);
    (async () => {
      const s = await loadSession();
      if (!s) return apply(null);
      try {
        apply(await api<MeResponse>('me'));
      } catch {
        apply(null);
      }
    })();
  }, [apply, signedOut]);

  const value = useMemo<AuthState>(
    () => ({
      status,
      user,
      signIn: async (phone, password) => {
        const r = await api<AuthResponse>('auth/login', { body: { phone, password, deviceName: 'ChamaHub mobile' }, auth: false });
        await saveTokens(r.tokens);
        apply(r.user);
      },
      signUp: async (input) => {
        const r = await api<AuthResponse>('auth/register', { body: input, auth: false });
        await saveTokens(r.tokens);
        apply(r.user);
      },
      verifyPhone: async (code) => {
        apply(await api<AuthUser>('auth/verify-phone', { body: { code } }));
      },
      signOut: async () => {
        await api('auth/logout', { method: 'POST' }).catch(() => undefined);
        await saveTokens(null);
        signedOut();
      },
      refreshUser: async () => apply(await api<MeResponse>('me')),
    }),
    [status, user, apply, signedOut],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}
