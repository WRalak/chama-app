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
import { colors, font, radius, shadow, space, TOUCH, type, withFont } from '@/theme';

export type IconName = keyof typeof Ionicons.glyphMap;

export function T({ variant = 'body', style, children, numberOfLines, ...rest }: { variant?: keyof typeof type; style?: StyleProp<TextStyle>; children: ReactNode; numberOfLines?: number; accessibilityRole?: 'header' | 'text' }) {
  return (
    <Text style={withFont([type[variant], style as TextStyle])} numberOfLines={numberOfLines} maxFontSizeMultiplier={1.6} {...rest}>
      {children}
    </Text>
  );
}

export function Screen({ children, scroll = true, refreshing, onRefresh, padded = true, edges = ['bottom'], contentStyle, ...rest }: { children: ReactNode; scroll?: boolean; refreshing?: boolean; onRefresh?: () => void; padded?: boolean; edges?: ('top' | 'bottom')[]; contentStyle?: StyleProp<ViewStyle> } & Pick<ScrollViewProps, 'keyboardShouldPersistTaps'>) {
  const inner = padded ? { padding: space.lg, paddingBottom: space.xxl } : undefined;
  return (
    <SafeAreaView style={styles.screen} edges={edges}>
      {scroll ? (
        <ScrollView contentContainerStyle={[inner, contentStyle]} keyboardShouldPersistTaps="handled" refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} colors={[colors.rose]} tintColor={colors.rose} /> : undefined} {...rest}>
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
      style={({ pressed }) => [styles.button, { backgroundColor: pressed && v.pressed ? v.pressed : v.bg, borderColor: v.border }, off && { opacity: 0.5 }, style]}
    >
      {loading ? <ActivityIndicator color={v.fg} /> : icon ? <Ionicons name={icon} size={18} color={v.fg} style={{ marginRight: 6 }} /> : null}
      {!loading && <Text style={[type.label, font('700'), { color: v.fg, fontSize: 15 }]} maxFontSizeMultiplier={1.4}>{title}</Text>}
    </Pressable>
  );
}

const buttonVariants: Record<ButtonVariant, { bg: string; fg: string; border: string; pressed?: string }> = {
  primary: { bg: colors.berry, fg: colors.white, border: colors.berry, pressed: colors.berryPressed },
  secondary: { bg: colors.white, fg: colors.text, border: colors.border, pressed: colors.blush },
  ghost: { bg: 'transparent', fg: colors.berry, border: 'transparent', pressed: colors.blush },
  danger: { bg: colors.errorText, fg: colors.white, border: colors.errorText, pressed: '#8A1621' },
};

export const Field = forwardRef<TextInput, TextInputProps & { label: string; error?: string; hint?: string; prefix?: string }>(function Field({ label, error, hint, prefix, style, ...props }, ref) {
  return (
    <View style={{ marginBottom: space.md }}>
      <T variant="label" style={{ marginBottom: 6 }}>
        {label}
      </T>
      <View style={[styles.input, error ? { borderColor: colors.error, borderWidth: 1.5 } : null]}>
        {prefix && <T variant="label" style={{ color: colors.muted, marginRight: 6 }}>{prefix}</T>}
        <TextInput ref={ref} placeholderTextColor={colors.placeholder} style={[type.body, { flex: 1, paddingVertical: 0 }, style]} accessibilityLabel={label} maxFontSizeMultiplier={1.6} {...props} />
      </View>
      {error ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }} accessibilityRole="alert">
          <Ionicons name="alert-circle" size={14} color={colors.errorText} style={{ marginRight: 4 }} />
          <T variant="small" style={{ color: colors.errorText, flex: 1 }}>{error}</T>
        </View>
      ) : hint ? (
        <T variant="small" style={{ marginTop: 4 }}>
          {hint}
        </T>
      ) : null}
    </View>
  );
});

const toneMap = {
  green: { bg: colors.successTint, fg: colors.successText, icon: 'checkmark-circle' as IconName },
  amber: { bg: colors.pendingTint, fg: colors.pendingText, icon: 'time' as IconName },
  red: { bg: colors.errorTint, fg: colors.errorText, icon: 'alert-circle' as IconName },
  blue: { bg: colors.infoTint, fg: colors.info, icon: 'information-circle' as IconName },
  rose: { bg: colors.blush, fg: colors.berry, icon: 'sparkles' as IconName },
  neutral: { bg: colors.neutralTint, fg: '#5E4A5A', icon: 'ellipse-outline' as IconName },
};
export type Tone = keyof typeof toneMap;

const STATUS_TONE: Record<string, Tone> = {
  CONFIRMED: 'green', PAID: 'green', APPROVED: 'green', COMPLETED: 'green', ACTIVE: 'green', REPAID: 'green', READY: 'green', PRESENT: 'green', HELD: 'green', RESOLVED: 'green',
  DISBURSED: 'blue', SCHEDULED: 'neutral', UPCOMING: 'neutral', REPORTED: 'blue',
  PENDING: 'amber', PENDING_APPROVAL: 'amber', PARTIAL: 'amber', DUE: 'amber', COLLECTING: 'amber', OUTSTANDING: 'amber', APOLOGY: 'amber', READINESS_CHECK: 'amber', AWAITING_APPROVAL: 'amber', PROCESSING: 'blue', DRAFT: 'amber', OPEN: 'amber',
  FAILED: 'red', REVERSED: 'red', REJECTED: 'red', OVERDUE: 'red', DISPUTED: 'red', DECLINED: 'neutral', CANCELLED: 'neutral', WAIVED: 'neutral', RETIRED: 'neutral',
};

/** Plain-language status names, so a status never depends on colour. */
const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Awaiting verification', REPORTED: 'Reported', CONFIRMED: 'Confirmed', PENDING_APPROVAL: 'Awaiting approval', COLLECTING: 'Collecting', READY: 'Fully collected',
  READINESS_CHECK: 'Readiness check', AWAITING_APPROVAL: 'Awaiting approval', PROCESSING: 'Sent, confirming', DRAFT: 'Awaiting approval', OVERDUE: 'Overdue', PARTIAL: 'Part paid',
};

const STATUS_ICON: Partial<Record<string, IconName>> = { REVERSED: 'arrow-undo', DISPUTED: 'flag', CANCELLED: 'close-circle', WAIVED: 'remove-circle', SCHEDULED: 'calendar', UPCOMING: 'calendar', PROCESSING: 'paper-plane', DISBURSED: 'paper-plane', REPORTED: 'document-text' };

export function Badge({ label, tone = 'neutral', icon }: { label: string; tone?: Tone; icon?: IconName | false }) {
  const t = toneMap[tone];
  const ic = icon === false ? null : (icon ?? t.icon);
  return (
    <View style={{ backgroundColor: t.bg, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center' }} accessible accessibilityLabel={label}>
      {ic && <Ionicons name={ic} size={12} color={t.fg} style={{ marginRight: 4 }} />}
      <Text style={[type.tiny, { color: t.fg, letterSpacing: 0.2 }]} maxFontSizeMultiplier={1.4}>
        {label}
      </Text>
    </View>
  );
}

/** A record status with its label and icon. */
export function StatusBadge({ status }: { status: string }) {
  const tone = STATUS_TONE[status] ?? 'neutral';
  const label = STATUS_LABEL[status] ?? status.charAt(0) + status.slice(1).replace(/_/g, ' ').toLowerCase();
  return <Badge label={label} tone={tone} icon={STATUS_ICON[status]} />;
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
          <Ionicons name={icon} size={18} color={colors.berry} />
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
      {onPress && <Ionicons name="chevron-forward" size={18} color={colors.placeholder} style={{ marginLeft: 4 }} />}
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel} android_ripple={{ color: colors.neutralTint }}>
      {content}
    </Pressable>
  );
}

export function Stat({ label, value, tone, sub }: { label: string; value: string; tone?: 'warning' | 'danger' | 'success'; sub?: string }) {
  const color = tone === 'danger' ? colors.errorText : tone === 'warning' ? colors.pendingText : tone === 'success' ? colors.successText : colors.text;
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
      <ActivityIndicator color={colors.rose} />
      <T variant="small" style={{ marginTop: space.sm }}>{label}</T>
    </View>
  );
}

export function ErrorView({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <View style={{ padding: space.xl, alignItems: 'center' }} accessibilityRole="alert">
      <Ionicons name="cloud-offline-outline" size={28} color={colors.errorText} />
      <T variant="label" style={{ marginTop: space.sm, textAlign: 'center' }}>Could not load this</T>
      <T variant="small" style={{ textAlign: 'center', marginTop: 4 }}>{error instanceof Error ? error.message : 'Check your connection and try again.'}</T>
      {onRetry && <Button title="Try again" variant="secondary" onPress={onRetry} style={{ marginTop: space.md, minWidth: 140 }} />}
    </View>
  );
}

export function Notice({ tone = 'blue', children, icon = 'information-circle-outline' }: { tone?: Tone; children: ReactNode; icon?: IconName }) {
  const t = toneMap[tone];
  return (
    <View style={{ flexDirection: 'row', backgroundColor: t.bg, borderRadius: radius.md, padding: space.md, marginBottom: space.lg }} accessibilityRole={tone === 'red' ? 'alert' : undefined}>
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
          <Pressable key={o.value} onPress={() => onChange(o.value)} accessibilityRole="button" accessibilityState={{ selected: active }} style={[styles.chip, active && { backgroundColor: colors.blush, borderColor: colors.rose }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              {active && <Ionicons name="checkmark" size={14} color={colors.berry} style={{ marginRight: 4 }} />}
              <Text style={[type.label, { color: active ? colors.berry : colors.text }]} maxFontSizeMultiplier={1.4}>
                {o.label}
              </Text>
            </View>
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
  block: { backgroundColor: colors.white, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: 'hidden', ...shadow },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingHorizontal: space.lg, paddingVertical: space.md },
  rowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rowIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.blush, alignItems: 'center', justifyContent: 'center', marginRight: space.md },
  chip: { minHeight: 40, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white, justifyContent: 'center' },
});

/** A labelled progress bar (e.g. collection progress); percent is 0–100. */
export function Progress({ percent, label, tone = 'green' }: { percent: number; label?: string; tone?: 'green' | 'amber' }) {
  const p = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: p }} accessibilityLabel={label}>
      <View style={{ height: 10, backgroundColor: colors.blush, borderRadius: 5, overflow: 'hidden' }}>
        <View style={{ width: `${p}%`, height: 10, borderRadius: 5, backgroundColor: tone === 'green' ? colors.rose : colors.pending }} />
      </View>
      {label && <T variant="small" style={{ marginTop: 4 }}>{label}</T>}
    </View>
  );
}

/** Large square shortcut used on the management dashboard. */
export function Tile({ icon, label, onPress, badge }: { icon: IconName; label: string; onPress: () => void; badge?: number }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={badge ? `${label}, ${badge} waiting` : label} style={({ pressed }) => [{ width: '23%', minWidth: 76, alignItems: 'center', paddingVertical: space.sm }, pressed && { opacity: 0.7 }]}>
      <View style={{ width: 52, height: 52, borderRadius: radius.md, backgroundColor: colors.blush, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={icon} size={22} color={colors.berry} />
        {!!badge && (
          <View style={{ position: 'absolute', top: -4, right: -6, minWidth: 20, height: 20, borderRadius: 10, backgroundColor: colors.errorText, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }}>
            <Text style={[font('700'), { color: colors.white, fontSize: 11 }]}>{badge}</Text>
          </View>
        )}
      </View>
      <T variant="small" style={{ marginTop: 6, textAlign: 'center', color: colors.text, fontSize: 12 }} numberOfLines={2}>{label}</T>
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

/* ---------- financial building blocks ---------- */

/**
 * A headline amount with its meaning spelled out. `status` says whether the
 * figure is confirmed money or something still pending, in words and an icon.
 */
export function MoneyCard({ label, amount, status, sub, onPress, icon }: { label: string; amount: string; status?: { text: string; tone: Tone }; sub?: string; onPress?: () => void; icon?: IconName }) {
  const body = (
    <View style={[styles.block, { padding: space.lg, marginBottom: space.md }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
          {icon && <Ionicons name={icon} size={18} color={colors.rose} style={{ marginRight: 6 }} />}
          <T variant="small" style={{ flex: 1 }}>{label}</T>
        </View>
        {status && <Badge label={status.text} tone={status.tone} />}
      </View>
      <T variant="amount" style={{ marginTop: 4 }}>{amount}</T>
      {sub ? <T variant="small" style={{ marginTop: 2 }}>{sub}</T> : null}
    </View>
  );
  return onPress ? <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${label}: ${amount}${status ? `, ${status.text}` : ''}`}>{body}</Pressable> : body;
}

/** One money movement: what, when, how much, and its verification status. */
export function TransactionRow({ title, subtitle, amount, direction = 'in', status, onPress, last }: { title: string; subtitle?: string; amount: string; direction?: 'in' | 'out'; status?: string; onPress?: () => void; last?: boolean }) {
  return (
    <Row
      icon={direction === 'in' ? 'arrow-down-circle-outline' : 'arrow-up-circle-outline'}
      title={title}
      subtitle={subtitle}
      right={<T variant="body" style={[font('700'), { fontVariant: ['tabular-nums'] }]}>{`${direction === 'out' ? '−' : ''}${amount}`}</T>}
      rightSub={status ? <StatusBadge status={status} /> : undefined}
      onPress={onPress}
      last={last}
      accessibilityLabel={`${title}, ${direction === 'out' ? 'paid out' : 'paid in'} ${amount}${status ? `, ${STATUS_LABEL[status] ?? status.toLowerCase()}` : ''}`}
    />
  );
}

/** Member initials on a blush circle. */
export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('');
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.blush, alignItems: 'center', justifyContent: 'center' }} accessibilityElementsHidden importantForAccessibility="no">
      <Text style={[font('700'), { color: colors.berry, fontSize: size * 0.38 }]}>{initials || '?'}</Text>
    </View>
  );
}

/** Success or failure screen after a consequential action, with what happens next. */
export function ResultView({ ok, title, body, action }: { ok: boolean; title: string; body?: string; action?: ReactNode }) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: space.xxl, paddingHorizontal: space.lg }} accessibilityRole={ok ? 'summary' : 'alert'}>
      <View style={{ width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: ok ? colors.successTint : colors.errorTint }}>
        <Ionicons name={ok ? 'checkmark' : 'close'} size={32} color={ok ? colors.successText : colors.errorText} />
      </View>
      <T variant="heading" style={{ marginTop: space.md, textAlign: 'center' }}>{title}</T>
      {body ? <T variant="small" style={{ marginTop: 4, textAlign: 'center' }}>{body}</T> : null}
      {action ? <View style={{ marginTop: space.lg, alignSelf: 'stretch' }}>{action}</View> : null}
    </View>
  );
}
