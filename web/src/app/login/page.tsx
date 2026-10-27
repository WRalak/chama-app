'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { phoneSchema, safeRedirectPath } from '@chamahub/shared';
import { BrandMark } from '@/components/shell/brand';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';

const schema = z.object({ phone: phoneSchema, password: z.string().min(1, 'Enter your password') });
type Form = z.input<typeof schema>;

function LoginForm() {
  const router = useRouter();
  const next = useSearchParams().get('next');
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<Form>({ resolver: zodResolver(schema) });

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    const res = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return setError(body.message ?? 'Sign-in failed');
    if (!body.user.phoneVerified) {
      router.replace('/verify');
      return;
    }
    router.replace(safeRedirectPath(next, '/'));
    router.refresh();
  });

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <Field label="Phone number" htmlFor="phone" error={formState.errors.phone?.message}>
        <Input id="phone" autoComplete="tel" inputMode="tel" placeholder="0712 345 678" {...register('phone')} aria-invalid={!!formState.errors.phone} />
      </Field>
      <Field label="Password" htmlFor="password" error={formState.errors.password?.message}>
        <Input id="password" type="password" autoComplete="current-password" {...register('password')} aria-invalid={!!formState.errors.password} />
      </Field>
      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-danger" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" className="w-full" loading={formState.isSubmitting}>
        Sign in
      </Button>
      <p className="text-center text-sm">
        <Link href="/forgot-password" className="text-berry hover:underline">
          Forgot your password?
        </Link>
      </p>
      <p className="text-center text-sm text-muted">
        New to ChamaHub?{' '}
        <Link href="/sign-up" className="text-berry hover:underline">
          Create an account
        </Link>
      </p>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <BrandMark className="h-10 w-10" />
          <h1 className="mt-3 text-lg font-semibold text-plum">Sign in to ChamaHub</h1>
          <p className="text-sm text-muted">For members and officers</p>
        </div>
        <div className="rounded-lg border border-line bg-white p-5">
          <Suspense>
            <LoginForm />
          </Suspense>
        </div>
        <p className="mt-4 text-center text-xs text-muted">Use the same phone number and password as the ChamaHub mobile app.</p>
        <p className="mt-2 text-center text-xs text-muted">
          <Link href="/privacy" className="hover:text-berry hover:underline">Privacy</Link> · <Link href="/terms" className="hover:text-berry hover:underline">Terms</Link>
        </p>
      </div>
    </main>
  );
}
