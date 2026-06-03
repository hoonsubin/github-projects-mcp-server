// =============================================================================
// scripts/audit/renderers/plantuml.ts — C4 diagram → PlantUML source
//
// Transforms a C4DiagramResult into PlantUML C4 stencil syntax.
// Each C4 level (context/container/component/code) produces a separate diagram.
// =============================================================================

import type {
  C4DiagramResult,
  C4Element,
  C4ElementType,
  C4Level,
  C4Relationship,
  C4SliceLevel,
} from "../types.ts";

// ── Stereotype mapping ─────────────────────────────────────────────────────────

const STEREOTYPE_MAP: Record<C4ElementType, string> = {
  person: "Person",
  system: "System",
  container: "Container",
  component: "Component",
  function: "Component",
  class: "Component",
  interface: "Component",
  external_api: "System_Ext",
};

const C4_INCLUDE_MAP: Record<C4Level, string> = {
  context: "C4_Context",
  container: "C4_Container",
  component: "C4_Component",
  code: "C4_Component",
};

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Collect all individual @startuml…@enduml diagram strings for a result.
 */
const collectDiagrams = (result: C4DiagramResult): string[] => {
  const levels: C4Level[] = ["context", "container", "component", "code"];
  const diagrams: string[] = [];
  for (const level of levels) {
    diagrams.push(renderDiagram(result.readTools[level], level, "Read Tools"));
    diagrams.push(renderDiagram(result.writeTools[level], level, "Write Tools"));
  }
  return diagrams;
};

/**
 * Render the full C4 diagram result as raw PlantUML source.
 * Each @startuml…@enduml block is separated by a blank line.
 */
export const renderC4Source = (result: C4DiagramResult): string =>
  collectDiagrams(result).join("\n\n") + "\n";

/**
 * Render a C4 diagram result with each diagram in its own ```plantuml fence.
 * Suitable for embedding inline in a markdown document.
 */
export const renderC4Fenced = (result: C4DiagramResult): string =>
  collectDiagrams(result)
    .map((d) => "```plantuml\n" + d + "\n```")
    .join("\n\n") + "\n";

// ── Internal rendering ─────────────────────────────────────────────────────────

const renderDiagram = (
  slice: C4SliceLevel,
  level: C4Level,
  category: string,
): string => {
  const include = C4_INCLUDE_MAP[level];
  const lines: string[] = [];

  lines.push("@startuml");
  lines.push(`!include <c4/${include}>`);
  lines.push("");
  lines.push(`title ${category} — ${level} diagram`);
  lines.push("");

  for (const elem of slice.elements) {
    lines.push(renderElement(elem));
  }

  if (slice.elements.length > 0 && slice.relationships.length > 0) {
    lines.push("");
  }

  for (const rel of slice.relationships) {
    lines.push(renderRelationship(rel));
  }

  lines.push("");
  lines.push("@enduml");

  return lines.join("\n");
};

const renderElement = (elem: C4Element): string => {
  const stereotype = STEREOTYPE_MAP[elem.type];
  const tech = elem.technology ? `, "${elem.technology}"` : "";
  const desc = elem.description ? `, "${elem.description}"` : "";
  return `${stereotype}(${elem.id}, "${elem.name}"${tech}${desc})`;
};

const renderRelationship = (rel: C4Relationship): string => {
  const label = rel.label ? `, "${rel.label}"` : "";
  const tech = rel.technology ? `, "${rel.technology}"` : "";
  if (rel.direction === "reverse") {
    return `Rel(${rel.to}, ${rel.from}${label}${tech})`;
  }
  return `Rel(${rel.from}, ${rel.to}${label}${tech})`;
};
