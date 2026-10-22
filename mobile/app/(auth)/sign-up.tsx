import { zodResolver } from '@hookform/resolvers/zod';
import { Link } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { View } from 'react-native';
import { z } from 'zod';
import { registerSchema } from '@chamahub/shared';
import { BrandHeader } from '@/components/brand';
import { Button, Field, Notice, Screen, T } from '@/components/ui';
import { errorText } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { colors, space, withFont } from '@/theme';

const schema = registerSchema.extend({ confirm: z.string() }).refine((v) => v.password === v.confirm, { message: 'Passwords do not match', path: ['confirm'] });
type Form = z.input<typeof schema>;

export default function SignUp() {
  const { signUp } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const { control, handleSubmit, formState } = useForm<Form>({ resolver: zodResolver(schema), defaultValues: { fullName: '', phone: '', email: '', password: '', confirm: '' } });
  const submit = handleSubmit(async (v) => {
    setError(null);
    try {
      await signUp({ fullName: v.fullName, phone: v.phone, email: v.email || undefined, password: v.password });
    } catch (e) {
      setError(errorText(e));
    }
  });
  const e = formState.errors;
  return (
    <Screen edges={['top', 'bottom']}>
      <BrandHeader title="Create your account" subtitle="One account for all your Chamas" />
      <Controller control={control} name="fullName" render={({ field }) => <Field label="Full name" autoComplete="name" textContentType="name" value={field.value} onChangeText={field.onChange} error={e.fullName?.message} />} />
      <Controller control={control} name="phone" render={({ field }) => <Field label="Phone number" placeholder="0712 345 678" keyboardType="phone-pad" autoComplete="tel" value={field.value} onChangeText={field.onChange} error={e.phone?.message} hint="We will send a code by SMS to confirm it is yours." />} />
      <Controller control={control} name="email" render={({ field }) => <Field label="Email (optional)" keyboardType="email-address" autoCapitalize="none" autoComplete="email" value={field.value ?? ''} onChangeText={field.onChange} error={e.email?.message} />} />
      <Controller control={control} name="password" render={({ field }) => <Field label="Password" secureTextEntry autoComplete="new-password" textContentType="newPassword" value={field.value} onChangeText={field.onChange} error={e.password?.message} hint="At least 8 characters, with a letter and a number." />} />
      <Controller control={control} name="confirm" render={({ field }) => <Field label="Confirm password" secureTextEntry value={field.value} onChangeText={field.onChange} error={e.confirm?.message} />} />
      {error && <Notice tone="red" icon="alert-circle-outline">{error}</Notice>}
      <Button title="Create account" onPress={submit} loading={formState.isSubmitting} />
      <T variant="small" style={{ textAlign: 'center', marginTop: space.md }}>
        By creating an account you agree to the{' '}
        <Link href="/legal/terms" style={withFont({ color: colors.berry, fontWeight: '600' })}>Terms of Use</Link> and{' '}
        <Link href="/legal/privacy" style={withFont({ color: colors.berry, fontWeight: '600' })}>Privacy Policy</Link>.
      </T>
      <View style={{ marginTop: space.lg, alignItems: 'center' }}>
        <T variant="small">
          Already registered?{' '}
          <Link href="/(auth)/sign-in" style={withFont({ color: colors.berry, fontWeight: '600' })}>
            Sign in
          </Link>
        </T>
      </View>
    </Screen>
  );
}
