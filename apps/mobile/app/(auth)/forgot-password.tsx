import { router } from 'expo-router';
import { useState } from 'react';
import { normalizeKenyanPhone, passwordSchema } from '@chamahub/shared';
import { BrandHeader } from '@/components/brand';
import { Button, Field, Notice, Screen } from '@/components/ui';
import { api, errorText } from '@/lib/api';

export default function ForgotPassword() {
  const [step, setStep] = useState<'phone' | 'code' | 'done'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    if (!normalizeKenyanPhone(phone)) return setError('Enter a valid Kenyan mobile number');
    setBusy(true);
    setError(null);
    try {
      await api('auth/otp/request', { body: { phone, purpose: 'RESET_PASSWORD' }, auth: false });
      setStep('code');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function reset() {
    const pw = passwordSchema.safeParse(password);
    if (!pw.success) return setError(pw.error.issues[0].message);
    setBusy(true);
    setError(null);
    try {
      await api('auth/password/reset', { body: { phone, code, newPassword: password }, auth: false });
      setStep('done');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Screen edges={['top', 'bottom']}>
      <BrandHeader title="Reset password" subtitle="We will send a code to your registered phone number." />
      {step === 'phone' && (
        <>
          <Field label="Phone number" placeholder="0712 345 678" keyboardType="phone-pad" value={phone} onChangeText={setPhone} />
          {error && <Notice tone="red">{error}</Notice>}
          <Button title="Send code" onPress={send} loading={busy} />
        </>
      )}
      {step === 'code' && (
        <>
          <Field label="6-digit code" keyboardType="number-pad" textContentType="oneTimeCode" maxLength={6} value={code} onChangeText={(t) => setCode(t.replace(/\D/g, ''))} />
          <Field label="New password" secureTextEntry value={password} onChangeText={setPassword} hint="At least 8 characters, with a letter and a number." />
          {error && <Notice tone="red">{error}</Notice>}
          <Button title="Set new password" onPress={reset} loading={busy} disabled={code.length !== 6} />
        </>
      )}
      {step === 'done' && (
        <>
          <Notice tone="green" icon="checkmark-circle-outline">Your password was changed and other devices were signed out.</Notice>
          <Button title="Sign in" onPress={() => router.replace('/(auth)/sign-in')} />
        </>
      )}
      {step !== 'done' && <Button title="Back to sign in" variant="ghost" onPress={() => router.back()} style={{ marginTop: 8 }} />}
    </Screen>
  );
}
