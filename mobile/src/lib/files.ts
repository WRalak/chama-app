import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { Alert, Platform } from 'react-native';
import { EVIDENCE_MAX_BYTES } from '@chamahub/shared';

export interface PickedFile {
  fileName: string;
  mimeType: string;
  /** Base64 contents. */
  data: string;
  sizeBytes: number;
}

const sizeOf = (b64: string) => Math.floor((b64.length * 3) / 4) - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0);

async function readBase64(asset: DocumentPicker.DocumentPickerAsset): Promise<string> {
  if (Platform.OS === 'web' && asset.file) {
    const buf = new Uint8Array(await asset.file.arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return btoa(s);
  }
  return new File(asset.uri).base64();
}

/** A receipt photo or screenshot from the gallery (or a PDF), kept under the 3 MB evidence limit. */
export async function pickReceipt(source: 'photo' | 'camera' | 'pdf'): Promise<PickedFile | null> {
  if (source === 'pdf') {
    const r = await DocumentPicker.getDocumentAsync({ type: ['application/pdf'], copyToCacheDirectory: true });
    if (r.canceled || !r.assets[0]) return null;
    const a = r.assets[0];
    const data = await readBase64(a);
    return check({ fileName: a.name, mimeType: 'application/pdf', data, sizeBytes: sizeOf(data) });
  }
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Camera not allowed', 'Allow camera access in your phone settings, or choose a photo instead.');
      return null;
    }
  }
  const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], base64: true, quality: 0.6, allowsEditing: false };
  const r = source === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
  if (r.canceled || !r.assets[0]?.base64) return null;
  const a = r.assets[0];
  const mimeType = a.mimeType === 'image/png' || a.mimeType === 'image/webp' ? a.mimeType : 'image/jpeg';
  const data = a.base64!;
  return check({ fileName: a.fileName ?? `receipt.${mimeType === 'image/png' ? 'png' : 'jpg'}`, mimeType, data, sizeBytes: sizeOf(data) });
}

function check(f: PickedFile): PickedFile | null {
  if (f.sizeBytes > EVIDENCE_MAX_BYTES) {
    Alert.alert('File too large', 'Evidence must be under 3 MB. Take a screenshot or a smaller photo.');
    return null;
  }
  return f;
}

/** An M-Pesa, Paybill or bank statement exported as CSV or Excel. */
export async function pickStatement(): Promise<{ fileName: string; csv?: string; xlsxBase64?: string } | null> {
  const r = await DocumentPicker.getDocumentAsync({ type: ['text/csv', 'text/comma-separated-values', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel', '*/*'], copyToCacheDirectory: true });
  if (r.canceled || !r.assets[0]) return null;
  const a = r.assets[0];
  const lower = a.name.toLowerCase();
  if (lower.endsWith('.xlsx')) return { fileName: a.name, xlsxBase64: await readBase64(a) };
  if (lower.endsWith('.csv') || lower.endsWith('.txt')) {
    const text = Platform.OS === 'web' && a.file ? await a.file.text() : await new File(a.uri).text();
    return { fileName: a.name, csv: text };
  }
  if (lower.endsWith('.pdf')) Alert.alert('PDF statements', 'PDF statements cannot be read yet. Download the statement as Excel or CSV from the M-Pesa, Paybill or bank portal.');
  else Alert.alert('Unsupported file', 'Choose a .csv or .xlsx statement.');
  return null;
}
