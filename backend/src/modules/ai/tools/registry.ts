import { ForbiddenException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { AiCard, AiLink, formatKes, Permission } from '@chamahub/shared';
import { z, ZodTypeAny } from 'zod';
import { MembershipContext } from '../../../common/request';

/** What a tool runs as. Built by the server from the authenticated request, never from model output. */
export interface ToolContext {
  groupId: string;
  groupName: string;
  viewer: MembershipContext;
}

export interface AiToolDefinition<S extends ZodTypeAny = ZodTypeAny> {
  name: string;
  description: string;
  /** JSON schema shown to the model; `input` re-validates on the server. */
  jsonSchema: Record<string, unknown>;
  input: S;
  /** Any one of these permissions in the caller's current group allows the tool. Empty = every member. */
  anyOf: Permission[];
  run(ctx: ToolContext, input: z.infer<S>): Promise<AiCard | AiCard[]>;
}

export const defineTool = <S extends ZodTypeAny>(t: AiToolDefinition<S>) => t;

export const NO_INPUT = { type: 'object', properties: {}, additionalProperties: false } as const;

export function allowed(def: AiToolDefinition, viewer: MembershipContext) {
  return def.anyOf.length === 0 || def.anyOf.some((p) => viewer.permissions.includes(p));
}

export const money = (cents: number) => formatKes(cents);

const MAX_ROWS = 30;

export function card(c: { tool: string; title: string; kind?: AiCard['kind']; period?: AiCard['period']; facts?: AiCard['facts']; columns?: string[]; rows?: string[][]; notes?: string[]; text?: string | null; links?: AiLink[] }): AiCard {
  const rows = c.rows ?? [];
  return {
    tool: c.tool,
    kind: c.kind ?? 'VERIFIED',
    title: c.title,
    asOf: new Date().toISOString(),
    period: c.period ?? null,
    facts: c.facts ?? [],
    table: c.columns ? { columns: c.columns, rows: rows.slice(0, MAX_ROWS), truncated: rows.length > MAX_ROWS } : null,
    notes: c.notes ?? [],
    text: c.text ?? null,
    links: c.links ?? [],
  };
}

export type ToolOutcome = 'OK' | 'DENIED' | 'INVALID' | 'UNKNOWN_TOOL' | 'ERROR';

export interface ToolRunResult {
  outcome: ToolOutcome;
  cards: AiCard[];
  /** Plain explanation for the model and the user when the tool did not run. */
  error: string | null;
}

/**
 * Runs one tool for one caller. The tool name must be on the allowlist, the
 * input must validate, the caller's current permissions must allow it, and
 * the group comes from the authenticated request. Services re-check their own
 * rules (e.g. a member can only open their own loan) on top of this.
 */
export async function runTool(tools: Map<string, AiToolDefinition>, name: string, rawInput: unknown, ctx: ToolContext): Promise<ToolRunResult> {
  const def = tools.get(name);
  if (!def) return { outcome: 'UNKNOWN_TOOL', cards: [], error: `There is no tool called "${name}".` };
  if (!allowed(def, ctx.viewer)) return { outcome: 'DENIED', cards: [], error: 'This information is not available to the user’s role in this group.' };
  const parsed = def.input.safeParse(rawInput ?? {});
  if (!parsed.success) return { outcome: 'INVALID', cards: [], error: `Invalid input: ${parsed.error.issues.map((i) => `${i.path.join('.') || 'input'} ${i.message}`).join('; ')}` };
  try {
    const out = await def.run(ctx, parsed.data);
    return { outcome: 'OK', cards: Array.isArray(out) ? out : [out], error: null };
  } catch (err) {
    if (err instanceof ForbiddenException) return { outcome: 'DENIED', cards: [], error: err.message };
    if (err instanceof NotFoundException) return { outcome: 'INVALID', cards: [], error: `${err.message} (or it is not visible to this user).` };
    if (err instanceof UnprocessableEntityException) return { outcome: 'INVALID', cards: [], error: err.message };
    return { outcome: 'ERROR', cards: [], error: 'The records could not be read right now.' };
  }
}
