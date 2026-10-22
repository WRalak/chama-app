'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { registerSchema } from '@chamahub/shared';
import { BrandMark } from '@/components/shell/brand';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';

type Form = z.input<typeof registerSchema>;

export default function SignUpPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<Form>({ resolver: zodResolver(registerSchema) });
  const e = formState.errors;

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    const res = await fetch('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return setError(body.message ?? 'Sign-up failed');
    router.replace('/verify');
    router.refresh();
  });

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <BrandMark className="h-10 w-10" />
          <h1 className="mt-3 text-lg font-semibold text-plum">Create your ChamaHub account</h1>
          <p className="text-sm text-muted">The same account works on the web and in the mobile app.</p>
        </div>
        <form onSubmit={onSubmit} className="space-y-4 rounded-lg border border-line bg-white p-5" noValidate>
          <Field label="Full name" htmlFor="fullName" error={e.fullName?.message}>
            <Input id="fullName" autoComplete="name" {...register('fullName')} aria-invalid={!!e.fullName} />
          </Field>
          <Field label="Phone number" htmlFor="phone" error={e.phone?.message} hint="We send a code to this number to verify it.">
            <Input id="phone" autoComplete="tel" inputMode="tel" placeholder="0712 345 678" {...register('phone')} aria-invalid={!!e.phone} />
          </Field>
          <Field label="Email (optional)" htmlFor="email" error={e.email?.message}>
            <Input id="email" type="email" autoComplete="email" {...register('email')} aria-invalid={!!e.email} />
          </Field>
          <Field label="Password" htmlFor="password" error={e.password?.message} hint="At least 8 characters, including a letter and a number.">
            <Input id="password" type="password" autoComplete="new-password" {...register('password')} aria-invalid={!!e.password} />
          </Field>
          {error && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-danger" role="alert">
              {error}
            </p>
          )}
          <Button type="submit" className="w-full" loading={formState.isSubmitting}>
            Create account
          </Button>
        </form>
        <p className="mt-4 text-center text-sm text-muted">
          Already have an account?{' '}
          <Link href="/login" className="text-berry hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
