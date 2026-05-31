// =============================================================================
// scripts/audit/types.ts — Shared types and the AuditStage interface
// =============================================================================

import type { UnusedExport } from "../diagram/types.ts";

// ── AuditStage interface ───────────────────────────────────────────────────────

export interface AuditStage<TStageResult> {
  readonly name: string;
  run(config: AuditConfig, deps: StageDependencies): Promise<TStageResult> | TStageResult;
}

// ── Shared dependencies passed to every stage ──────────────────────────────────

export interface StageDependencies {
  /** Parsed dependency-cruiser JSON output. Populated once per pipeline run. */
  depcruiseJson?: DepcruiseOutput;
  /** Parsed dependency-cruiser JSON output with --metrics flag. */
  depcruiseMetricsJson?: DepcruiseOutput;
}

// ── CLI configuration ──────────────────────────────────────────────────────────

export interface AuditConfig {
  readonly srcDir: string;
  readonly outputPath: string;
  readonly skipStages: string[];
  readonly excludeTests: boolean;
}

// ── depcruise JSON output types (matching actual v17 output) ───────────────────

export interface DepcruiseOutput {
  readonly modules: readonly DepcruiseModule[];
  readonly summary: DepcruiseSummary;
}

export interface DepcruiseModule {
  readonly source: string;
  readonly dependencies: readonly DepcruiseDependency[];
  readonly dependents: readonly string[];
  readonly orphan: boolean;
  readonly valid: boolean;
  readonly instability?: number;
  readonly abstractness?: number;
  readonly distance?: number;
}

export interface DepcruiseDependency {
  readonly module: string;
  readonly resolved: string;
  readonly moduleSystem: string;
  readonly dependencyTypes: readonly string[];
  readonly circular: boolean;
  readonly valid: boolean;
}

export interface DepcruiseSummary {
  readonly violations: readonly DepcruiseViolation[];
  readonly error: number;
  readonly warn: number;
  readonly info: number;
  readonly ignore: number;
  readonly totalCruised: number;
  readonly ruleSetUsed: DepcruiseRuleSet;
}

export interface DepcruiseRuleSet {
  readonly forbidden: readonly DepcruiseRuleDef[];
}

export interface DepcruiseRuleDef {
  readonly name: string;
  readonly severity: "error" | "warn" | "info" | "ignore";
}

export interface DepcruiseViolation {
  readonly type: string;
  readonly from: string;
  readonly to: string;
  readonly rule: DepcruiseRuleDef;
}

// ── Stage result types ─────────────────────────────────────────────────────────

export interface RuleCompliance {
  readonly ruleName: string;
  readonly severity: "error" | "warn" | "info" | "ignore";
  readonly passed: boolean;
  readonly violationCount: number;
  readonly offendingModules: readonly string[];
}

export interface ComplianceResult {
  readonly moduleCount: number;
  readonly rules: readonly RuleCompliance[];
}

export type LayerName =
  | "entrypoint"
  | "framework"
  | "use-case"
  | "domain"
  | "adapter";

export interface LayerNode {
  readonly source: string;
  readonly layer: LayerName;
}

export interface LayerEdge {
  readonly from: string;
  readonly to: string;
  readonly fromLayer: LayerName;
  readonly toLayer: LayerName;
  readonly isViolation: boolean;
  readonly violatedRuleNames: readonly string[];
}

export interface LayerGraphResult {
  readonly nodes: readonly LayerNode[];
  readonly edges: readonly LayerEdge[];
}

export type StabilityZone = "low-risk" | "moderate" | "high-risk";

export interface ModuleStability {
  readonly source: string;
  readonly layer: LayerName;
  readonly abstractness: number;
  readonly instability: number;
  readonly distance: number;
  readonly zone: StabilityZone;
}

export interface StabilityResult {
  readonly modules: readonly ModuleStability[];
}

export interface LayerFileStats {
  readonly layer: LayerName;
  readonly fileCount: number;
  readonly totalLines: number;
  readonly topThreeLargest: readonly FileStatEntry[];
}

export interface FileStatEntry {
  readonly path: string;
  readonly lines: number;
}

export interface FileStatsResult {
  readonly layers: readonly LayerFileStats[];
}

export interface UnusedExportResult {
  readonly exports: readonly UnusedExport[];
}

export type AnyStageResult =
  | ComplianceResult
  | LayerGraphResult
  | StabilityResult
  | FileStatsResult
  | UnusedExportResult;

export type AuditResults = Record<string, AnyStageResult | undefined>;
