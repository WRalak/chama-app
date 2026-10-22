import { useQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { AiCard, AiChatResponse, AiStatus } from '@chamahub/shared';
import { AiCardView } from '@/components/ai';
import { Badge, Button, ErrorView, Loading, Notice, T } from '@/components/ui';
import { api } from '@/lib/api';
import { useGroupAccess } from '@/lib/group';
import { isOnline } from '@/lib/queries';
import { colors, radius, space } from '@/theme';

interface Turn {
  id: string;
  role: 'user' | 'assistant' | 'records' | 'error';
  text: string;
  cards: AiCard[];
  refused: string[];
}

let seq = 0;
const turnId = () => `t${++seq}`;

/**
 * The assistant for this group. Questions go to the AI, which can only read
 * records through server tools allowed for the member's role. Quick answers
 * show the same records directly, and work even when the AI is unavailable.
 */
export default function Assistant() {
  const { groupId, group, roleLabel } = useGroupAccess();
  const status = useQuery({ queryKey: ['ai-status', groupId], queryFn: () => api<AiStatus>(`groups/${groupId}/ai/status`), enabled: !!groupId });
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const scroll = useRef<ScrollView>(null);
  const chatOn = !!status.data?.chatAvailable;

  const push = (t: Omit<Turn, 'id'>) => {
    setTurns((x) => [...x, { ...t, id: turnId() }]);
    setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 50);
  };

  const quick = async (tool: string, label: string, args?: Record<string, unknown>) => {
    push({ role: 'user', text: label, cards: [], refused: [] });
    setBusy(true);
    try {
      const r = await api<{ cards: AiCard[] }>(`groups/${groupId}/ai/tools/${tool}`, { body: { args: args ?? {} } });
      push({ role: 'records', text: '', cards: r.cards, refused: [] });
    } catch (e) {
      push({ role: 'error', text: e instanceof Error ? e.message : 'Could not read the records.', cards: [], refused: [] });
    } finally {
      setBusy(false);
    }
  };

  const ask = async (message: string) => {
    const text = message.trim();
    if (!text || busy) return;
    if (!(await isOnline())) {
      push({ role: 'error', text: 'You are offline. Connect to the internet to ask the assistant.', cards: [], refused: [] });
      return;
    }
    setDraft('');
    push({ role: 'user', text, cards: [], refused: [] });
    setBusy(true);
    try {
      const r = await api<AiChatResponse>(`groups/${groupId}/ai/chat`, { body: { conversationId, message: text, locale: 'en' } });
      setConversationId(r.conversationId);
      push({ role: 'assistant', text: r.message.text, cards: r.message.cards, refused: r.message.refused });
    } catch (e) {
      push({ role: 'error', text: e instanceof Error ? e.message : 'The assistant failed. Try a quick answer.', cards: [], refused: [] });
      status.refetch();
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView edges={['bottom']} style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen options={{ title: 'Assistant', headerRight: () => (turns.length ? <Button title="New" variant="ghost" onPress={() => { setTurns([]); setConversationId(undefined); }} /> : null) }} />
      {status.error ? <ErrorView error={status.error} onRetry={status.refetch} /> : !status.data ? <Loading /> : (
        <>
          <ScrollView ref={scroll} contentContainerStyle={{ padding: space.lg, paddingBottom: space.xl }} keyboardShouldPersistTaps="handled">
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: space.sm }}>
              <T variant="small" style={{ flex: 1 }}>{`${group.data?.name ?? ''} · you are ${roleLabel.toLowerCase()}`}</T>
              <Badge label={chatOn ? 'AI on' : 'Quick answers only'} tone={chatOn ? 'green' : 'neutral'} />
            </View>
            {!chatOn && status.data.reason && <Notice tone="neutral" icon="information-circle-outline">{status.data.reason}</Notice>}
            {turns.length === 0 && (
              <Notice tone="blue" icon="sparkles-outline">
                {`Ask about your group's records. Answers use only what your role may see, and every figure comes from ChamaHub's records. The assistant cannot move money or approve anything. Conversations are kept for ${status.data.retentionDays} days.`}
              </Notice>
            )}
            {turns.map((t) => (
              <View key={t.id} style={{ alignItems: t.role === 'user' ? 'flex-end' : 'stretch', marginBottom: space.md }}>
                {t.role === 'user' ? (
                  <View style={{ backgroundColor: colors.berry, borderRadius: radius.lg, paddingVertical: space.sm, paddingHorizontal: space.md, maxWidth: '85%' }}>
                    <T variant="body" style={{ color: colors.white }}>{t.text}</T>
                  </View>
                ) : t.role === 'error' ? (
                  <Notice tone="red" icon="alert-circle-outline">{t.text}</Notice>
                ) : (
                  <View>
                    {t.role === 'assistant' && (
                      <View style={{ backgroundColor: colors.white, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: space.md }}>
                        <T variant="small" style={{ marginBottom: 4, color: colors.info, fontWeight: '600' }}>AI answer — check it against the records below</T>
                        <T variant="body">{t.text}</T>
                        {t.refused.length > 0 && <T variant="small" style={{ marginTop: 4 }}>Some information was not available to your role.</T>}
                      </View>
                    )}
                    {t.role === 'records' && <T variant="small" style={{ fontWeight: '600' }}>From your group's records</T>}
                    {t.cards.map((c, i) => <AiCardView key={`${t.id}-${i}`} card={c} groupId={groupId} />)}
                  </View>
                )}
              </View>
            ))}
            {busy && (
              <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center', marginBottom: space.md }} accessibilityLiveRegion="polite">
                <ActivityIndicator color={colors.berry} />
                <T variant="small">Checking your records…</T>
              </View>
            )}
            <T variant="small" style={{ marginBottom: space.xs, marginTop: space.sm }}>{chatOn ? 'Try asking' : 'Quick answers'}</T>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
              {status.data.suggestions.map((s) => (
                <Pressable
                  key={s.label}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel={chatOn ? s.prompt : `Show ${s.label}`}
                  onPress={() => (chatOn ? ask(s.prompt) : quick(s.tool, s.label, s.args))}
                  onLongPress={() => quick(s.tool, s.label, s.args)}
                  style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white, borderRadius: 999, paddingVertical: 6, paddingHorizontal: space.md, opacity: busy ? 0.5 : 1 }}
                >
                  <T variant="small" style={{ color: colors.text }}>{s.label}</T>
                </Pressable>
              ))}
            </View>
            {chatOn && <T variant="small" style={{ marginTop: space.xs }}>Long-press a suggestion to see the records without the AI.</T>}
          </ScrollView>
          {chatOn && (
            <View style={{ flexDirection: 'row', gap: space.sm, padding: space.md, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.white }}>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder="Ask about contributions, payouts, loans…"
                accessibilityLabel="Question for the assistant"
                multiline
                maxLength={2000}
                style={{ flex: 1, minHeight: 44, maxHeight: 120, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.sm, fontSize: 16, color: colors.text }}
                onSubmitEditing={() => ask(draft)}
              />
              <Button title="Ask" onPress={() => ask(draft)} disabled={!draft.trim() || busy} />
            </View>
          )}
        </>
      )}
    </SafeAreaView>
  );
}
