import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { FlatList, NativeScrollEvent, NativeSyntheticEvent, Pressable, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BrandLockup, BrandMark } from '@/components/brand';
import { Button, T } from '@/components/ui';
import { markOnboarded, readOnboarded } from '@/lib/storage';
import { colors, radius, space } from '@/theme';

/* ---------- illustrations: built from the app's own UI language, no image assets ---------- */

function Card({ children }: { children: React.ReactNode }) {
  return <View style={{ width: '100%', maxWidth: 320, backgroundColor: colors.white, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: space.lg, gap: space.md }}>{children}</View>;
}

function Pill({ label, tone }: { label: string; tone: 'green' | 'amber' | 'neutral' }) {
  const t = { green: [colors.forestTint, colors.forest], amber: [colors.warningTint, '#B45309'], neutral: [colors.slateTint, '#334155'] }[tone];
  return <Text style={{ backgroundColor: t[0], color: t[1], fontSize: 11, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, overflow: 'hidden', textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</Text>;
}

function OweArt() {
  return (
    <Card>
      <T variant="tiny">NEXT PAYMENT · UPENDO CHAMA</T>
      <Text style={{ fontSize: 28, fontWeight: '800', color: colors.navy }}>KES 5,000</Text>
      <T variant="small">Due Friday, 7 Nov · weekly contribution</T>
      <View style={{ height: 1, backgroundColor: colors.border }} />
      {[['October', 'Paid', 'green'], ['November', 'Due', 'amber'], ['December', 'Upcoming', 'neutral']].map(([m, s, t]) => (
        <View key={m} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <T variant="body">{m}</T>
          <Pill label={s} tone={t as 'green' | 'amber' | 'neutral'} />
        </View>
      ))}
    </Card>
  );
}

function PayoutArt() {
  const rows: [number, string, string, boolean][] = [
    [1, 'Mary W.', 'Paid out', false],
    [2, 'Daniel O.', 'Paid out', false],
    [3, 'You', '14 Nov', true],
    [4, 'Joyce K.', '21 Nov', false],
  ];
  return (
    <Card>
      <T variant="tiny">PAYOUT ORDER · APPROVED</T>
      {rows.map(([n, who, when, me]) => (
        <View key={n} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: me ? space.sm : 0, marginHorizontal: me ? -space.sm : 0, borderRadius: radius.md, backgroundColor: me ? colors.forestTint : 'transparent' }}>
          <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: me ? colors.forest : colors.slateTint, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontWeight: '700', color: me ? colors.white : colors.navy }}>{n}</Text>
          </View>
          <Text style={{ flex: 1, fontSize: 15, fontWeight: me ? '700' : '400', color: colors.navy }}>{who}</Text>
          <T variant="small" style={{ color: me ? colors.forest : colors.muted, fontWeight: me ? '700' : '400' }}>{when}</T>
        </View>
      ))}
    </Card>
  );
}

function TrustArt() {
  const steps: [string, string][] = [
    ['receipt-outline', 'Payment recorded with its M-Pesa code'],
    ['people-outline', 'Verified by a second officer'],
    ['checkmark-done-outline', 'Payout confirmed by the recipient'],
    ['document-lock-outline', 'Every change kept on record'],
  ];
  return (
    <Card>
      {steps.map(([icon, label]) => (
        <View key={label} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.forestTint, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name={icon as never} size={18} color={colors.forest} />
          </View>
          <T variant="body" style={{ flex: 1 }}>{label}</T>
          <Ionicons name="checkmark-circle" size={18} color={colors.emerald} />
        </View>
      ))}
    </Card>
  );
}

interface Slide {
  key: string;
  title: string;
  body: string;
  art: React.ReactNode;
}

const SLIDES: Slide[] = [
  { key: 'welcome', title: 'Your Chama, organised', body: 'Merry-go-rounds, table banking, investment and welfare groups — contributions, payouts and records in one place.', art: <BrandLockup size={84} tagline={false} /> },
  { key: 'owe', title: 'Know what you owe', body: 'See every contribution that is due, what you have paid and what is outstanding, across all your Chamas, from one account.', art: <OweArt /> },
  { key: 'paid', title: 'Know when you get paid', body: 'An approved, numbered payout calendar. Nobody’s position changes without an approved amendment that everyone can see.', art: <PayoutArt /> },
  { key: 'trust', title: 'Every shilling accounted for', body: 'Money only counts once it is verified, payouts complete only when confirmed, and nothing is ever silently edited.', art: <TrustArt /> },
];

export default function Welcome() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const list = useRef<FlatList<Slide>>(null);
  const [index, setIndex] = useState(0);
  const [checked, setChecked] = useState(false);

  // Shown once per device; afterwards go straight to sign-in.
  useEffect(() => {
    readOnboarded().then((done) => (done ? router.replace('/(auth)/sign-in') : setChecked(true)));
  }, [router]);

  const finish = async (to: '/(auth)/sign-in' | '/(auth)/sign-up') => {
    await markOnboarded();
    router.replace(to);
  };
  const goTo = (i: number) => {
    list.current?.scrollToOffset({ offset: i * width, animated: true });
    setIndex(i);
  };
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => setIndex(Math.round(e.nativeEvent.contentOffset.x / width));
  const last = index === SLIDES.length - 1;

  if (!checked) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
        <BrandMark size={72} />
      </View>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <View style={{ height: 48, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', paddingHorizontal: space.lg }}>
        {!last && (
          <Pressable onPress={() => finish('/(auth)/sign-in')} accessibilityRole="button" hitSlop={12} style={{ padding: space.sm }}>
            <Text style={{ color: colors.muted, fontWeight: '600', fontSize: 15 }}>Skip</Text>
          </Pressable>
        )}
      </View>
      <FlatList
        ref={list}
        data={SLIDES}
        keyExtractor={(s) => s.key}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScroll}
        onScroll={onScroll}
        scrollEventThrottle={64}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        renderItem={({ item }) => (
          <View style={{ width, paddingHorizontal: space.xl, justifyContent: 'center' }}>
            <View style={{ minHeight: 300, alignItems: 'center', justifyContent: 'center' }}>{item.art}</View>
            <T variant="title" style={{ fontSize: 26, lineHeight: 32, textAlign: 'center', marginTop: space.xl }} accessibilityRole="header">
              {item.title}
            </T>
            <T variant="body" style={{ textAlign: 'center', color: colors.muted, marginTop: space.md, lineHeight: 22 }}>
              {item.body}
            </T>
          </View>
        )}
      />
      <View style={{ paddingHorizontal: space.xl, paddingBottom: space.lg, gap: space.md }}>
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6, marginBottom: space.sm }} accessibilityLabel={`Page ${index + 1} of ${SLIDES.length}`}>
          {SLIDES.map((s, i) => (
            <Pressable key={s.key} onPress={() => goTo(i)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Go to page ${i + 1}`}>
              <View style={{ width: i === index ? 22 : 8, height: 8, borderRadius: 4, backgroundColor: i === index ? colors.forest : colors.border }} />
            </Pressable>
          ))}
        </View>
        {last ? (
          <>
            <Button title="Create an account" onPress={() => finish('/(auth)/sign-up')} />
            <Button title="I already have an account" variant="secondary" onPress={() => finish('/(auth)/sign-in')} />
          </>
        ) : (
          <Button title="Next" onPress={() => goTo(index + 1)} icon="arrow-forward" />
        )}
      </View>
    </SafeAreaView>
  );
}
