import { Ionicons } from '@expo/vector-icons';
import { forwardRef, ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  ScrollViewProps,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, radius, space, TOUCH, type } from '@/theme';

export type IconName = keyof typeof Ionicons.glyphMap;

export function T({ variant = 'body', style, children, numberOfLines, ...rest }: { variant?: keyof typeof type; style?: StyleProp<TextStyle>; children: ReactNode; numberOfLines?: number; accessibilityRole?: 'header' | 'text' }) {
  return (
    <Text style={[type[variant], style]} numberOfLines={numberOfLines} maxFontSizeMultiplier={1.6} {...rest}>
      {children}
    </Text>
  );
}

export function Screen({ children, scroll = true, refreshing, onRefresh, padded = true, edges = ['bottom'], contentStyle, ...rest }: { children: ReactNode; scroll?: boolean; refreshing?: boolean; onRefresh?: () => void; padded?: boolean; edges?: ('top' | 'bottom')[]; contentStyle?: StyleProp<ViewStyle> } & Pick<ScrollViewProps, 'keyboardShouldPersistTaps'>) {
  const inner = padded ? { padding: space.lg, paddingBottom: space.xxl } : undefined;
  return (
    <SafeAreaView style={styles.screen} edges={edges}>
      {scroll ? (
        <ScrollView contentContainerStyle={[inner, contentStyle]} keyboardShouldPersistTaps="handled" refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} colors={[colors.forest]} tintColor={colors.forest} /> : undefined} {...rest}>
          {children}
        </ScrollView>
      ) : (
        <View style={[{ flex: 1 }, inner, contentStyle]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({ title, onPress, variant = 'primary', loading, disabled, icon, style, accessibilityHint }: { title: string; onPress: () => void; variant?: ButtonVariant; loading?: boolean; disabled?: boolean; icon?: IconName; style?: StyleProp<ViewStyle>; accessibilityHint?: string }) {
  const v = buttonVariants[variant];
  const off = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      accessibilityHint={accessibilityHint}
      style={({ pressed }) => [styles.button, { backgroundColor: v.bg, borderColor: v.border }, pressed && { opacity: 0.85 }, off && { opacity: 0.5 }, style]}
    >
      {loading ? <ActivityIndicator color={v.fg} /> : icon ? <Ionicons name={icon} size={18} color={v.fg} style={{ marginRight: 6 }} /> : null}
      {!loading && <Text style={[type.label, { color: v.fg, fontSize: 15 }]}>{title}</Text>}
    </Pressable>
  );
}

const buttonVariants: Record<ButtonVariant, { bg: string; fg: string; border: string }> = {
  primary: { bg: colors.forest, fg: colors.white, border: colors.forest },
  secondary: { bg: colors.white, fg: colors.navy, border: colors.border },
  ghost: { bg: 'transparent', fg: colors.forest, border: 'transparent' },
  danger: { bg: colors.error, fg: colors.white, border: colors.error },
};

export const Field = forwardRef<TextInput, TextInputProps & { label: string; error?: string; hint?: string; prefix?: string }>(function Field({ label, error, hint, prefix, style, ...props }, ref) {
  return (
    <View style={{ marginBottom: space.md }}>
      <T variant="label" style={{ marginBottom: 6 }}>
        {label}
      </T>
      <View style={[styles.input, error ? { borderColor: colors.error } : null]}>
        {prefix && <T variant="label" style={{ color: colors.muted, marginRight: 6 }}>{prefix}</T>}
        <TextInput ref={ref} placeholderTextColor="#94A3B8" style={[type.body, { flex: 1, paddingVertical: 0 }, style]} accessibilityLabel={label} maxFontSizeMultiplier={1.6} {...props} />
      </View>
      {error ? (
        <T variant="small" style={{ color: colors.error, marginTop: 4 }}>
          {error}
        </T>
      ) : hint ? (
        <T variant="small" style={{ marginTop: 4 }}>
          {hint}
        </T>
      ) : null}
    </View>
  );
});

const toneMap = {
  green: { bg: colors.forestTint, fg: colors.forest },
  amber: { bg: colors.warningTint, fg: '#B45309' },
  red: { bg: colors.errorTint, fg: '#B91C1C' },
  blue: { bg: colors.infoTint, fg: colors.info },
  neutral: { bg: colors.slateTint, fg: '#334155' },
};
export type Tone = keyof typeof toneMap;

const STATUS_TONE: Record<string, Tone> = {
  CONFIRMED: 'green', PAID: 'green', APPROVED: 'green', COMPLETED: 'green', ACTIVE: 'green', REPAID: 'green', READY: 'green', PRESENT: 'green', HELD: 'green',
  DISBURSED: 'blue', SCHEDULED: 'neutral', UPCOMING: 'neutral',
  PENDING: 'amber', PENDING_APPROVAL: 'amber', PARTIAL: 'amber', DUE: 'amber', COLLECTING: 'amber', OUTSTANDING: 'amber', APOLOGY: 'amber', READINESS_CHECK: 'amber', AWAITING_APPROVAL: 'amber', PROCESSING: 'blue', DRAFT: 'amber',
  FAILED: 'red', REVERSED: 'red', REJECTED: 'red', OVERDUE: 'red', DISPUTED: 'red', DECLINED: 'neutral', CANCELLED: 'neutral', WAIVED: 'neutral',
};

const STATUS_LABEL: Record<string, string> = { PENDING: 'Pending verification', PENDING_APPROVAL: 'Awaiting approval', COLLECTING: 'Collecting', READY: 'Fully collected', READINESS_CHECK: 'Readiness check', AWAITING_APPROVAL: 'Awaiting approval', PROCESSING: 'Sent, confirming', DRAFT: 'Awaiting approval' };

export function Badge({ label, tone = 'neutral' }: { label: string; tone?: Tone }) {
  const t = toneMap[tone];
  return (
    <View style={{ backgroundColor: t.bg, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2, alignSelf: 'flex-start' }}>
      <Text style={[type.tiny, { color: t.fg }]} maxFontSizeMultiplier={1.4}>
        {label.toUpperCase()}
      </Text>
    </View>
  );
}

export function StatusBadge({ status }: { status: string }) {
  return <Badge label={STATUS_LABEL[status] ?? status.replace(/_/g, ' ').toLowerCase()} tone={STATUS_TONE[status] ?? 'neutral'} />;
}

/** A plain section: heading + white block with dividers. Avoids card-on-card layouts. */
export function Section({ title, action, children, style }: { title?: string; action?: ReactNode; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ marginBottom: space.xl }, style]}>
      {(title || action) && (
        <View style={styles.sectionHead}>
          {title ? <T variant="heading" accessibilityRole="header">{title}</T> : <View />}
          {action}
        </View>
      )}
      <View style={styles.block}>{children}</View>
    </View>
  );
}

export function Row({ title, subtitle, right, rightSub, onPress, icon, last, accessibilityLabel }: { title: ReactNode; subtitle?: ReactNode; right?: ReactNode; rightSub?: ReactNode; onPress?: () => void; icon?: IconName; last?: boolean; accessibilityLabel?: string }) {
  const content = (
    <View style={[styles.row, !last && styles.rowBorder]}>
      {icon && (
        <View style={styles.rowIcon}>
          <Ionicons name={icon} size={18} color={colors.forest} />
        </View>
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        {typeof title === 'string' ? <T variant="body" numberOfLines={2}>{title}</T> : title}
        {subtitle ? typeof subtitle === 'string' ? <T variant="small" numberOfLines={2}>{subtitle}</T> : subtitle : null}
      </View>
      {(right || rightSub) && (
        <View style={{ alignItems: 'flex-end', marginLeft: space.sm, maxWidth: '50%' }}>
          {typeof right === 'string' ? <T variant="body" style={{ fontVariant: ['tabular-nums'], fontWeight: '600' }}>{right}</T> : right}
          {rightSub ? typeof rightSub === 'string' ? <T variant="small">{rightSub}</T> : <View style={{ marginTop: 4 }}>{rightSub}</View> : null}
        </View>
      )}
      {onPress && <Ionicons name="chevron-forward" size={18} color="#94A3B8" style={{ marginLeft: 4 }} />}
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel} android_ripple={{ color: colors.slateTint }}>
      {content}
    </Pressable>
  );
}

export function Stat({ label, value, tone, sub }: { label: string; value: string; tone?: 'warning' | 'danger' | 'success'; sub?: string }) {
  const color = tone === 'danger' ? colors.error : tone === 'warning' ? colors.warning : tone === 'success' ? colors.success : colors.navy;
  return (
    <View style={{ flex: 1, padding: space.md }}>
      <T variant="small">{label}</T>
      <T variant="heading" style={{ color, marginTop: 2, fontVariant: ['tabular-nums'] }} numberOfLines={1}>
        {value}
      </T>
      {sub ? <T variant="small" style={{ fontSize: 12 }}>{sub}</T> : null}
    </View>
  );
}

export function StatGrid({ children }: { children: ReactNode[] }) {
  const rows: ReactNode[][] = [];
  children.forEach((c, i) => (i % 2 === 0 ? rows.push([c]) : rows[rows.length - 1].push(c)));
  return (
    <View style={[styles.block, { marginBottom: space.xl }]}>
      {rows.map((r, i) => (
        <View key={i} style={[{ flexDirection: 'row' }, i < rows.length - 1 && styles.rowBorder]}>
          {r[0]}
          <View style={{ width: StyleSheet.hairlineWidth, backgroundColor: colors.border }} />
          {r[1] ?? <View style={{ flex: 1 }} />}
        </View>
      ))}
    </View>
  );
}

export function Empty({ title, body, icon = 'file-tray-outline', action }: { title: string; body?: string; icon?: IconName; action?: ReactNode }) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: space.xl, paddingHorizontal: space.lg }}>
      <Ionicons name={icon} size={28} color={colors.muted} />
      <T variant="label" style={{ marginTop: space.sm, textAlign: 'center' }}>{title}</T>
      {body && <T variant="small" style={{ textAlign: 'center', marginTop: 4 }}>{body}</T>}
      {action && <View style={{ marginTop: space.md }}>{action}</View>}
    </View>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <View style={{ padding: space.xl, alignItems: 'center' }} accessibilityLabel={label} accessibilityRole="progressbar">
      <ActivityIndicator color={colors.forest} />
    </View>
  );
}

export function ErrorView({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <View style={{ padding: space.xl, alignItems: 'center' }} accessibilityRole="alert">
      <Ionicons name="cloud-offline-outline" size={28} color={colors.error} />
      <T variant="label" style={{ marginTop: space.sm, textAlign: 'center' }}>Could not load this</T>
      <T variant="small" style={{ textAlign: 'center', marginTop: 4 }}>{error instanceof Error ? error.message : 'Check your connection and try again.'}</T>
      {onRetry && <Button title="Try again" variant="secondary" onPress={onRetry} style={{ marginTop: space.md, minWidth: 140 }} />}
    </View>
  );
}

export function Notice({ tone = 'blue', children, icon = 'information-circle-outline' }: { tone?: Tone; children: ReactNode; icon?: IconName }) {
  const t = toneMap[tone];
  return (
    <View style={{ flexDirection: 'row', backgroundColor: t.bg, borderRadius: radius.md, padding: space.md, marginBottom: space.lg }}>
      <Ionicons name={icon} size={18} color={t.fg} style={{ marginRight: 8, marginTop: 1 }} />
      <View style={{ flex: 1 }}>{typeof children === 'string' ? <T variant="small" style={{ color: t.fg }}>{children}</T> : children}</View>
    </View>
  );
}

export function Chips<V extends string>({ options, value, onChange }: { options: { value: V; label: string }[]; value: V; onChange: (v: V) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: space.lg }} contentContainerStyle={{ gap: space.sm }}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable key={o.value} onPress={() => onChange(o.value)} accessibilityRole="button" accessibilityState={{ selected: active }} style={[styles.chip, active && { backgroundColor: colors.forest, borderColor: colors.forest }]}>
            <Text style={[type.label, { color: active ? colors.white : colors.navy }]} maxFontSizeMultiplier={1.4}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  button: { minHeight: TOUCH, borderRadius: radius.md, paddingHorizontal: space.lg, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', borderWidth: 1 },
  input: { minHeight: TOUCH, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.white, paddingHorizontal: space.md, flexDirection: 'row', alignItems: 'center' },
  block: { backgroundColor: colors.white, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, overflow: 'hidden' },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingHorizontal: space.lg, paddingVertical: space.md },
  rowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rowIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.forestTint, alignItems: 'center', justifyContent: 'center', marginRight: space.md },
  chip: { minHeight: 36, paddingHorizontal: space.md, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white, justifyContent: 'center' },
});

/** A labelled progress bar (e.g. collection progress); percent is 0–100. */
export function Progress({ percent, label, tone = 'green' }: { percent: number; label?: string; tone?: 'green' | 'amber' }) {
  const p = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: p }} accessibilityLabel={label}>
      <View style={{ height: 8, backgroundColor: colors.slateTint, borderRadius: 4, overflow: 'hidden' }}>
        <View style={{ width: `${p}%`, height: 8, backgroundColor: tone === 'green' ? colors.emerald : colors.warning }} />
      </View>
      {label && <T variant="small" style={{ marginTop: 4 }}>{label}</T>}
    </View>
  );
}

/** Large square shortcut used on the management dashboard. */
export function Tile({ icon, label, onPress, badge }: { icon: IconName; label: string; onPress: () => void; badge?: number }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={badge ? `${label}, ${badge} waiting` : label} style={({ pressed }) => [{ width: '23%', minWidth: 76, alignItems: 'center', paddingVertical: space.sm }, pressed && { opacity: 0.7 }]}>
      <View style={{ width: 48, height: 48, borderRadius: 14, backgroundColor: colors.forestTint, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={icon} size={22} color={colors.forest} />
        {!!badge && (
          <View style={{ position: 'absolute', top: -4, right: -6, minWidth: 20, height: 20, borderRadius: 10, backgroundColor: colors.error, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }}>
            <Text style={{ color: colors.white, fontSize: 11, fontWeight: '700' }}>{badge}</Text>
          </View>
        )}
      </View>
      <T variant="small" style={{ marginTop: 6, textAlign: 'center', color: colors.navy, fontSize: 12 }} numberOfLines={2}>{label}</T>
    </Pressable>
  );
}

/** One label/value line inside a Section. */
export function KV({ label, value, last }: { label: string; value: ReactNode; last?: boolean }) {
  return (
    <View style={[styles.row, { minHeight: 44, paddingVertical: space.sm }, !last && styles.rowBorder]}>
      <T variant="small" style={{ flex: 1 }}>{label}</T>
      {typeof value === 'string' ? <T variant="body" style={{ fontWeight: '600', textAlign: 'right', flexShrink: 1 }}>{value}</T> : value}
    </View>
  );
}

/** Shown when a section is opened without the permission for it (e.g. from an old link). */
export function NoAccess({ what }: { what: string }) {
  return <Empty icon="lock-closed-outline" title="Not available for your role" body={`Your role in this group does not include ${what}.`} />;
}
