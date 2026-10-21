import { Redirect } from 'expo-router';
import { useAuth } from '@/lib/auth';

export default function Index() {
  const { status } = useAuth();
  if (status === 'signedIn') return <Redirect href="/(app)/(tabs)" />;
  if (status === 'unverified') return <Redirect href="/(auth)/verify" />;
  return <Redirect href="/(auth)/welcome" />;
}
