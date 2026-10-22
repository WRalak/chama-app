import * as Clipboard from 'expo-clipboard';
import { Alert, Linking, Platform, Share } from 'react-native';
import type { ShareableSummary } from '@chamahub/shared';
import { api } from './api';

export async function copy(text: string, what = 'Copied') {
  await Clipboard.setStringAsync(text);
  if (Platform.OS !== 'web') Alert.alert(what, text.length > 60 ? undefined : text);
}

/** Opens WhatsApp with the text ready to send; falls back to the share sheet. */
export async function shareToWhatsApp(text: string) {
  const encoded = encodeURIComponent(text);
  if (Platform.OS === 'web') {
    globalThis.open?.(`https://wa.me/?text=${encoded}`, '_blank');
    return;
  }
  const app = `whatsapp://send?text=${encoded}`;
  try {
    if (await Linking.canOpenURL(app)) return await Linking.openURL(app);
  } catch {
    // fall through to the share sheet
  }
  await Share.share({ message: text });
}

/** Fetches a summary built from the group's confirmed records and offers it for WhatsApp. */
export async function shareSummary(path: string) {
  try {
    const s = await api<ShareableSummary>(path);
    await shareToWhatsApp(s.text);
  } catch (e) {
    Alert.alert('Cannot share yet', e instanceof Error ? e.message : 'Try again later');
  }
}
