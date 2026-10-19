import { Alert, Platform } from 'react-native';

/** Asks before an irreversible step. React Native Web has no Alert, so the browser preview uses window.confirm. */
export function askToConfirm(title: string, message: string, confirmLabel: string, onConfirm: () => void) {
  if (Platform.OS === 'web') {
    if (globalThis.confirm?.(`${title}\n\n${message}`)) onConfirm();
    return;
  }
  Alert.alert(title, message, [{ text: 'Cancel', style: 'cancel' }, { text: confirmLabel, onPress: onConfirm }]);
}
