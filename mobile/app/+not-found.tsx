import { router } from 'expo-router';
import { View } from 'react-native';
import { Button, Screen, T } from '@/components/ui';
import { space } from '@/theme';

/** Shown for a link to a screen that does not exist (e.g. an old notification). */
export default function NotFound() {
  return (
    <Screen edges={['top', 'bottom']}>
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: space.md, paddingVertical: space.xl * 2 }}>
        <T variant="title" style={{ textAlign: 'center' }}>We could not find that screen</T>
        <T variant="body" style={{ textAlign: 'center' }}>The link may be old or the item may have moved. Your Chama records are safe.</T>
        <Button title="Go to Home" icon="home-outline" onPress={() => router.replace('/')} />
      </View>
    </Screen>
  );
}
