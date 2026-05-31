// =============================================================================
// scripts/audit/stages/compliance.ts — Architecture rule compliance check
//
// Parses depcruise JSON violations from summary.violations and produces a
// per-rule pass/fail summary using the rules declared in ruleSetUsed.forbidden.
// =============================================================================

import type { AuditStage, ComplianceResult, RuleCompliance } from "../types.ts";

export const complianceStage: AuditStage<ComplianceResult> = {
  name: "compliance",

  run: (_config, deps) => {
    const depcruiseJson = deps.depcruiseJson;

    if (!depcruiseJson) {
      return { moduleCount: 0, rules: [] };
    }

    const moduleCount = depcruiseJson.summary.totalCruised;
    const violations = depcruiseJson.summary.violations;
    const ruleDefs = depcruiseJson.summary.ruleSetUsed?.forbidden ?? [];

    // Build map of rule name → set of offending module sources
    const ruleViolations = new Map<string, Set<string>>();

    // Initialize from declared rules (so we report pass even with zero violations)
    for (const rule of ruleDefs) {
      ruleViolations.set(rule.name, new Set());
    }

    // Aggregate violations: from → to with rule info
    for (const violation of violations) {
      const existing = ruleViolations.get(violation.rule.name);
      if (existing) {
        existing.add(violation.from);
      } else {
        ruleViolations.set(violation.rule.name, new Set([violation.from]));
      }
    }

    const rules: RuleCompliance[] = ruleDefs
      .map((def) => {
        const offending = ruleViolations.get(def.name) ?? new Set();
        return {
          ruleName: def.name,
          severity: def.severity,
          passed: offending.size === 0,
          violationCount: offending.size,
          offendingModules: [...offending],
        };
      })
      .sort((a, b) => {
        if (a.severity === "error" && b.severity !== "error") return -1;
        if (b.severity === "error" && a.severity !== "error") return 1;
        return b.violationCount - a.violationCount;
      });

    return { moduleCount, rules };
  },
};
