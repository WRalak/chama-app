'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { AuthCard, FormError } from '@/components/platform/auth-card';
import { SetPasswordForm } from '@/components/platform/set-password-form';

function Reset() {
  const token = useSearchParams().get('token') ?? '';
  if (token.length < 32) return <FormError message="This reset link is incomplete. Open the full link from your e-mail." />;
  return <SetPasswordForm endpoint="platform/auth/reset-password" token={token} submitLabel="Save new password" doneText="Password changed. Every other session was signed out." />;
}

export default function PlatformResetPage() {
  return (
    <AuthCard title="Choose a new password">
      <Suspense>
        <Reset />
      </Suspense>
    </AuthCard>
  );
}
