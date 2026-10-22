import { View } from 'react-native';
import { Button, T } from './ui';
import { pickReceipt, PickedFile } from '@/lib/files';
import { space } from '@/theme';

/** Lets a member or officer attach a receipt photo, screenshot or PDF. Evidence helps the check; it is not proof by itself. */
export function EvidencePicker({ value, onChange }: { value: PickedFile | null; onChange: (f: PickedFile | null) => void }) {
  const pick = async (s: 'photo' | 'camera' | 'pdf') => {
    const f = await pickReceipt(s);
    if (f) onChange(f);
  };
  if (value) {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.md }}>
        <T variant="small" style={{ flex: 1 }}>{`Attached: ${value.fileName} (${Math.ceil(value.sizeBytes / 1024)} KB)`}</T>
        <Button title="Remove" variant="ghost" onPress={() => onChange(null)} />
      </View>
    );
  }
  return (
    <View style={{ marginBottom: space.md }}>
      <T variant="small" style={{ marginBottom: space.xs }}>Receipt or M-Pesa message screenshot (optional)</T>
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <Button title="Photo" icon="image-outline" variant="secondary" onPress={() => pick('photo')} style={{ flex: 1 }} />
        <Button title="Camera" icon="camera-outline" variant="secondary" onPress={() => pick('camera')} style={{ flex: 1 }} />
        <Button title="PDF" icon="document-outline" variant="secondary" onPress={() => pick('pdf')} style={{ flex: 1 }} />
      </View>
    </View>
  );
}
