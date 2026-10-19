import { zodResolver } from '@hookform/resolvers/zod';
import { Link } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { View } from 'react-native';
import { z } from 'zod';
import { phoneSchema } from '@chamahub/shared';
import { BrandHeader } from '@/components/brand';
import { Button, Field, Notice, Screen, T } from '@/components/ui';
import { errorText } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { colors, space } from '@/theme';

const schema = z.object({ phone: phoneSchema, password: z.string().min(1, 'Enter your password') });
type Form = z.input<typeof schema>;

export default function SignIn() {
  const { signIn } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const { control, handleSubmit, formState } = useForm<Form>({ resolver: zodResolver(schema), defaultValues: { phone: '', password: '' } });
  const submit = handleSubmit(async (v) => {
    setError(null);
    try {
      await signIn(v.phone, v.password);
    } catch (e) {
      setError(errorText(e));
    }
  });
  return (
    <Screen edges={['top', 'bottom']}>
      <BrandHeader title="ChamaHub" subtitle="Every Chama. Every Contribution. One Place." />
      <Controller control={control} name="phone" render={({ field }) => <Field label="Phone number" placeholder="0712 345 678" keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber" value={field.value} onChangeText={field.onChange} error={formState.errors.phone?.message} />} />
      <Controller control={control} name="password" render={({ field }) => <Field label="Password" secureTextEntry autoComplete="password" textContentType="password" value={field.value} onChangeText={field.onChange} onSubmitEditing={submit} error={formState.errors.password?.message} />} />
      {error && <Notice tone="red" icon="alert-circle-outline">{error}</Notice>}
      <Button title="Sign in" onPress={submit} loading={formState.isSubmitting} />
      <View style={{ marginTop: space.lg, alignItems: 'center', gap: space.md }}>
        <Link href="/(auth)/forgot-password" style={{ color: colors.forest, fontWeight: '600', padding: 8 }}>
          Forgot password?
        </Link>
        <T variant="small">
          New to ChamaHub?{' '}
          <Link href="/(auth)/sign-up" style={{ color: colors.forest, fontWeight: '600' }}>
            Create an account
          </Link>
        </T>
      </View>
    </Screen>
  );
}
