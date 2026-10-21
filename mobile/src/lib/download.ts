import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Alert, Platform } from 'react-native';
import { API_URL, authHeader } from './api';

/** Downloads an authenticated file from the API and opens the share sheet (save to Files, WhatsApp, email…). */
export async function downloadFile(path: string, filename: string, mimeType: string) {
  if (Platform.OS === 'web') {
    Alert.alert('Use the mobile app', 'Downloads are available in the Android and iOS app.');
    return;
  }
  try {
    const target = new File(Paths.cache, filename);
    if (target.exists) target.delete();
    const file = await File.downloadFileAsync(`${API_URL}/v1/${path}`, target, { headers: (await authHeader()) as Record<string, string> });
    if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(file.uri, { mimeType, dialogTitle: 'Save or share' });
    else Alert.alert('Saved', `Saved to ${file.uri}`);
  } catch (e) {
    Alert.alert('Could not download', e instanceof Error ? e.message : 'Try again later');
  }
}

export const downloadPdf = (path: string, filename: string) => downloadFile(path, filename, 'application/pdf');
export const downloadCsv = (path: string, filename: string) => downloadFile(path, filename, 'text/csv');
