import { useState } from 'react';
import { View } from 'react-native';
import { formatKenyanPhone } from '@chamahub/shared';
import { BrandHeader } from '@/components/brand';
import { Button, Field, Notice, Screen } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { space } from '@/theme';

export default function Verify() {
  const { user, verifyPhone, signOut } = useAuth();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'red' | 'green'; text: string } | null>(null);
  async function submit() {
    setBusy(true);
    setMsg(null);
    try {
      await verifyPhone(code);
    } catch (e) {
      setMsg({ tone: 'red', text: errorText(e) });
    } finally {
      setBusy(false);
    }
  }
  async function resend() {
    try {
      await api('auth/otp/resend', { method: 'POST' });
      setMsg({ tone: 'green', text: 'A new code is on its way.' });
    } catch (e) {
      setMsg({ tone: 'red', text: errorText(e) });
    }
  }
  return (
    <Screen edges={['top', 'bottom']}>
      <BrandHeader title="Verify your phone" subtitle={user ? `Enter the 6-digit code sent by SMS to ${formatKenyanPhone(user.phone)}` : undefined} />
      <Field label="Verification code" value={code} onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" autoComplete="sms-otp" textContentType="oneTimeCode" maxLength={6} style={{ letterSpacing: 8, fontSize: 22 }} />
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <Button title="Verify" onPress={submit} loading={busy} disabled={code.length !== 6} />
      <View style={{ marginTop: space.md, gap: space.sm }}>
        <Button title="Send a new code" variant="ghost" onPress={resend} />
        <Button title="Use a different account" variant="ghost" onPress={signOut} />
      </View>
    </Screen>
  );
}
