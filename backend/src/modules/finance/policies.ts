import { Prisma } from '@prisma/client';
import {
  defaultGroupSettings,
  defaultLoanPolicy,
  groupSettingsSchema,
  GroupSettingsInput,
  loanPolicySchema,
  LoanPolicyInput,
} from '@chamahub/shared';
import { z } from 'zod';

const settingsSchema = groupSettingsSchema.extend({ allowSelfVerification: z.boolean() });
export type GroupSettings = GroupSettingsInput & { allowSelfVerification: boolean };

export const DEFAULT_SETTINGS: GroupSettings = { ...defaultGroupSettings, allowSelfVerification: false };

export function readSettings(raw: Prisma.JsonValue): GroupSettings {
  const parsed = settingsSchema.partial().safeParse(raw ?? {});
  return { ...DEFAULT_SETTINGS, ...(parsed.success ? parsed.data : {}) };
}

export function readLoanPolicy(raw: Prisma.JsonValue): LoanPolicyInput {
  const parsed = loanPolicySchema.partial().safeParse(raw ?? {});
  return { ...defaultLoanPolicy, ...(parsed.success ? parsed.data : {}) };
}
