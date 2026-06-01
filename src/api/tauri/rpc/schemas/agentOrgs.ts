import { z } from "zod/v4";

import {
  AvailableAgentSchema,
  ModelTypeSchema,
  NativeHarnessTypeSchema,
} from "./validation";

const JsonRecordSchema = z.record(z.string(), z.unknown());

export const ConfigRecordSchema = JsonRecordSchema;

export const ConfigPartialInput = z.object({
  partial: JsonRecordSchema,
});

export const RawConfigWriteInput = z.object({
  content: z.string(),
});

export const HierarchyModeSchema = z.enum(["flat", "soft", "strict"]);
export const OrgMemberRuntimeConfigSchema = z.object({
  keySource: z.enum(["own_key", "hosted_key"]).optional(),
  accountId: z.string().optional(),
  model: z.string().optional(),
  nativeHarnessType: NativeHarnessTypeSchema.optional(),
  tier: z.string().optional(),
  listingModel: z.string().optional(),
  listingModelDisplay: z.string().optional(),
  listingModelType: ModelTypeSchema.optional(),
  selectedSourceLabel: z.string().optional(),
  selectedSourceModelType: ModelTypeSchema.optional(),
});

export type OrgMemberRuntimeConfig = z.infer<
  typeof OrgMemberRuntimeConfigSchema
>;

export type OrgMember = {
  id: string;
  name: string;
  role: string;
  agentId: string;
  runtimeConfig?: OrgMemberRuntimeConfig;
  description?: string;
  hierarchyMode?: z.output<typeof HierarchyModeSchema>;
  children: OrgMember[];
};

export const OrgMemberSchema: z.ZodType<OrgMember> = z.lazy(() =>
  z.object({
    id: z.string(),
    name: z.string(),
    role: z.string(),
    agentId: z.string(),
    runtimeConfig: OrgMemberRuntimeConfigSchema.optional(),
    description: z.string().optional(),
    hierarchyMode: HierarchyModeSchema.optional(),
    children: z.array(OrgMemberSchema),
  })
);

export const OrgJsonInput = z.object({
  orgJson: z.string(),
});

export const OrgIdInput = z.object({
  orgId: z.string(),
});

export const AvailableCliAgentsSchema = z.array(AvailableAgentSchema);

export const SkillsListInput = z.object({
  workspacePath: z.string().optional(),
  agentId: z.string().optional(),
});

export const SkillReadInput = z.object({
  workspacePath: z.string().optional(),
  name: z.string(),
});

export const SkillToggleInput = z.object({
  workspacePath: z.string().optional(),
  agentId: z.string().optional(),
  name: z.string(),
  enabled: z.boolean(),
});

export const DescriptionQualitySchema = z.enum(["good", "short", "missing"]);

export const SkillInfoSchema = z.object({
  name: z.string(),
  path: z.string(),
  description: z.string(),
  source: z.string(),
  available: z.boolean(),
  always: z.boolean(),
  enabled: z.boolean(),
  requiredBins: z.array(z.string()),
  requiredEnv: z.array(z.string()),
  estimatedTokens: z.number(),
  fullContentTokens: z.number(),
  descriptionQuality: DescriptionQualitySchema,
  version: z.string(),
});

export const SkillsListSchema = z.array(SkillInfoSchema);

export const CursorPluginSkillSchema = z.object({
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  skillPath: z.string(),
});

export type CursorPluginSkill = z.infer<typeof CursorPluginSkillSchema>;

export const CursorPluginHookSchema = z.object({
  eventType: z.string(),
  label: z.string(),
  hookPath: z.string(),
});

export type CursorPluginHook = z.infer<typeof CursorPluginHookSchema>;

export const CursorPluginInfoSchema = z.object({
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  version: z.string().nullable(),
  mcpConfig: z.record(z.string(), z.unknown()).nullable(),
  skills: z.array(CursorPluginSkillSchema),
  hooks: z.array(CursorPluginHookSchema),
  logoPath: z.string().nullable(),
});

export type CursorPluginInfo = z.infer<typeof CursorPluginInfoSchema>;
