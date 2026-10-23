'use client';

import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { AuthCard, FormError } from '@/components/platform/auth-card';
import { SetPasswordForm } from '@/components/platform/set-password-form';
import { LoadingRows } from '@/components/ui/states';
import { api, errorMessage } from '@/lib/api';
import { date } from '@/lib/utils';

function Accept() {
  const token = useSearchParams().get('token') ?? '';
  const inv = useQuery({ queryKey: ['invitation', token], queryFn: () => api<{ fullName: string; email: string; expiresAt: string }>('platform/auth/invitation', { query: { token } }), enabled: token.length >= 32, retry: false });
  if (token.length < 32) return <FormError message="This invitation link is incomplete. Open the full link from your e-mail." />;
  if (inv.isLoading) return <LoadingRows rows={3} />;
  if (inv.error) return <FormError message={errorMessage(inv.error)} />;
  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-blush/50 px-3 py-2 text-sm text-plum">
        <p className="font-semibold">{inv.data!.fullName}</p>
        <p className="text-muted">{inv.data!.email} · link expires {date(inv.data!.expiresAt)}</p>
      </div>
      <p className="text-sm text-muted">Choose your own password. Nobody at ChamaHub can see it or will ever ask for it.</p>
      <SetPasswordForm endpoint="platform/auth/accept-invitation" token={token} submitLabel="Create my account" doneText="Your account is ready. Sign in with your e-mail and new password." />
    </div>
  );
}

export default function AcceptInvitePage() {
  return (
    <AuthCard title="Set up your staff account">
      <Suspense>
        <Accept />
      </Suspense>
    </AuthCard>
  );
}
