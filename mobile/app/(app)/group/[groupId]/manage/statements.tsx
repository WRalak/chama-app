import { useQuery } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { Permission, STATEMENT_FIELDS, STATEMENT_MATCH_LABELS, StatementImportRow, StatementMapping, StatementPreview } from '@chamahub/shared';
import { Button, Chips, Empty, ErrorView, Loading, NoAccess, Notice, Row, Screen, Section, StatusBadge, T } from '@/components/ui';
import { api } from '@/lib/api';
import { useDestinations } from '@/lib/collections';
import { pickStatement } from '@/lib/files';
import { date, dateTime, kes } from '@/lib/format';
import { useGroupAccess } from '@/lib/group';
import { useAct } from '@/lib/queries';
import { colors, space } from '@/theme';

type Picked = NonNullable<Awaited<ReturnType<typeof pickStatement>>>;

/** Upload a statement you downloaded from M-Pesa, the Paybill portal or the bank; check the columns; then review the matches. */
export default function Statements() {
  const { groupId, can, canAny } = useGroupAccess();
  const imports = useQuery({ queryKey: ['statement-imports', groupId], queryFn: () => api<StatementImportRow[]>(`groups/${groupId}/statement-imports`), enabled: canAny(Permission.RECONCILIATION_MANAGE, Permission.AUDIT_VIEW) });
  const destinations = useDestinations(groupId);
  const [file, setFile] = useState<Picked | null>(null);
  const [mapping, setMapping] = useState<Partial<StatementMapping>>({});
  const [preview, setPreview] = useState<StatementPreview | null>(null);
  const [editing, setEditing] = useState<keyof StatementMapping | null>(null);
  const [destinationId, setDestinationId] = useState('');
  const runPreview = useAct((v: { f: Picked; m?: Partial<StatementMapping> }) => api<StatementPreview>(`groups/${groupId}/statement-imports/preview`, { body: { ...v.f, mapping: v.m } }), { onSuccess: (p) => { setPreview(p); setMapping(p.mapping); } });
  const doImport = useAct(() => api<{ id: string }>(`groups/${groupId}/statement-imports`, { body: { ...file!, mapping, destinationId: destinationId || undefined } }), {
    invalidate: [['statement-imports', groupId]],
    onSuccess: (r) => { setFile(null); setPreview(null); router.push({ pathname: '/(app)/group/[groupId]/manage/statement/[importId]', params: { groupId, importId: r.id } }); },
  });
  if (!canAny(Permission.RECONCILIATION_MANAGE, Permission.AUDIT_VIEW)) return <NoAccess what="statement imports" />;
  const choose = async () => {
    const f = await pickStatement();
    if (!f) return;
    setFile(f);
    setPreview(null);
    runPreview.mutate({ f });
  };
  const remap = (key: keyof StatementMapping, header: string | undefined) => {
    const m = { ...mapping, [key]: header };
    setMapping(m);
    setEditing(null);
    if (file) runPreview.mutate({ f: file, m });
  };
  const live = (destinations.data ?? []).filter((d) => d.status === 'ACTIVE');
  return (
    <Screen refreshing={imports.isRefetching} onRefresh={imports.refetch}>
      <Stack.Screen options={{ title: 'Statement import' }} />
      {can(Permission.RECONCILIATION_MANAGE) && (
        <>
          <Notice tone="neutral" icon="lock-closed-outline">Download the statement yourself from M-Pesa, the Paybill/Till portal or your bank, then upload the CSV or Excel file. ChamaHub never logs into your accounts.</Notice>
          {!file ? (
            <Button title="Choose statement file" icon="cloud-upload-outline" onPress={choose} style={{ marginBottom: space.lg }} />
          ) : (
            <Section title={file.fileName} action={<Button title="Change" variant="ghost" onPress={choose} />}>
              {runPreview.isPending || !preview ? <Loading label="Reading the file…" /> : (
                <View style={{ padding: space.lg, gap: space.sm }}>
                  <T variant="label">{`${preview.rowCount} rows`}</T>
                  <T variant="small">{Object.entries(preview.counts).map(([k, v]) => `${k === 'ERROR' ? 'Unreadable' : k === 'SKIPPED' ? 'Skipped' : STATEMENT_MATCH_LABELS[k as keyof typeof STATEMENT_MATCH_LABELS]}: ${v}`).join(' · ')}</T>
                  {preview.problems.map((p) => <Notice key={p} tone="red" icon="alert-circle-outline">{p}</Notice>)}
                  <T variant="label" style={{ marginTop: space.sm }}>Columns</T>
                  {STATEMENT_FIELDS.map((fld) => (
                    <View key={fld.key}>
                      <Row title={fld.label} subtitle={mapping[fld.key] ?? (fld.required ? 'Required — choose a column' : 'Not used')} onPress={() => setEditing(editing === fld.key ? null : fld.key)} />
                      {editing === fld.key && <Chips value={mapping[fld.key] ?? ''} onChange={(h) => remap(fld.key, h || undefined)} options={[{ value: '', label: 'Not used' }, ...preview.headers.map((h) => ({ value: h, label: h }))]} />}
                    </View>
                  ))}
                  <T variant="label" style={{ marginTop: space.sm }}>First lines</T>
                  {preview.sample.slice(0, 8).map((s) => (
                    <View key={s.rowNo} style={{ paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                      {s.ok ? (
                        <>
                          <T variant="small">{`Row ${s.rowNo} · ${dateTime(s.transactionAt!)} · ${kes(s.amountCents!)}${s.reference ? ` · ${s.reference}` : ''}`}</T>
                          <T variant="small">{`${s.payer ?? 'Unknown payer'} — ${STATEMENT_MATCH_LABELS[s.match!]}`}</T>
                        </>
                      ) : <T variant="small" style={{ color: s.skipped ? colors.muted : colors.error }}>{`Row ${s.rowNo}: ${s.error}`}</T>}
                    </View>
                  ))}
                  {live.length > 0 && (
                    <>
                      <T variant="label" style={{ marginTop: space.sm }}>Which account is this statement for?</T>
                      <Chips value={destinationId} onChange={setDestinationId} options={[{ value: '', label: 'Not sure' }, ...live.map((d) => ({ value: d.id, label: d.displayName }))]} />
                    </>
                  )}
                  <Button title="Import for review" onPress={() => doImport.mutate(undefined)} loading={doImport.isPending} disabled={preview.problems.length > 0} />
                  <T variant="small">Nothing is recorded yet: you review every match next, and ambiguous lines always wait for a person.</T>
                </View>
              )}
            </Section>
          )}
        </>
      )}
      <Section title="Imported statements">
        {imports.error ? <ErrorView error={imports.error} onRetry={imports.refetch} /> : !imports.data ? <Loading /> : imports.data.length === 0 ? <Empty title="No statements imported yet" icon="document-text-outline" /> : imports.data.map((s, i) => (
          <Row key={s.id} icon="document-text-outline" title={s.fileName} subtitle={`${date(s.periodFrom)} – ${date(s.periodTo)} · ${s.lineCount} lines${s.openCount ? ` · ${s.openCount} to review` : ''} · ${s.uploadedByName}`} rightSub={<StatusBadge status={s.status === 'REVIEWING' ? (s.openCount ? 'PENDING' : 'READY') : s.status === 'CLOSED' ? 'COMPLETED' : 'CANCELLED'} />} onPress={() => router.push({ pathname: '/(app)/group/[groupId]/manage/statement/[importId]', params: { groupId, importId: s.id } })} last={i === imports.data!.length - 1} />
        ))}
      </Section>
    </Screen>
  );
}
