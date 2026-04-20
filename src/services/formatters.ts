import type { ProjectV2, ProjectV2Item, ProjectV2Field } from "../types.ts";

// ── Shared GraphQL fragments ─────────────────────────────────────────────────

export const PROJECT_CORE_FRAGMENT = `
  id
  number
  title
  shortDescription
  url
  public
  closed
  createdAt
  updatedAt
  readme
  owner { login __typename }
  items { totalCount }
  fields(first: 30) {
    nodes {
      ... on ProjectV2Field { id name dataType }
      ... on ProjectV2SingleSelectField {
        id name dataType
        options { id name color description }
      }
      ... on ProjectV2IterationField {
        id name dataType
        configuration {
          iterations { id title startDate duration }
          completedIterations { id title startDate duration }
        }
      }
    }
  }
`;

export const ITEM_CONTENT_FRAGMENT = `
  content {
    ... on Issue {
      __typename id number title url state body
      assignees(first: 5) { nodes { login } }
      labels(first: 10) { nodes { name color } }
      milestone { title dueOn }
      repository { name nameWithOwner }
    }
    ... on PullRequest {
      __typename id number title url state body isDraft
      assignees(first: 5) { nodes { login } }
      labels(first: 10) { nodes { name color } }
      repository { name nameWithOwner }
    }
    ... on DraftIssue {
      __typename id title body
      assignees(first: 5) { nodes { login } }
    }
  }
`;

export const ITEM_FIELD_VALUES_FRAGMENT = `
  fieldValues(first: 20) {
    nodes {
      __typename
      ... on ProjectV2ItemFieldTextValue { text field { ... on ProjectV2FieldCommon { name } } }
      ... on ProjectV2ItemFieldNumberValue { number field { ... on ProjectV2FieldCommon { name } } }
      ... on ProjectV2ItemFieldDateValue { date field { ... on ProjectV2FieldCommon { name } } }
      ... on ProjectV2ItemFieldSingleSelectValue { name color optionId field { ... on ProjectV2FieldCommon { name } } }
      ... on ProjectV2ItemFieldIterationValue { title startDate duration iterationId field { ... on ProjectV2FieldCommon { name } } }
      ... on ProjectV2ItemFieldUserValue { users(first: 5) { nodes { login } } field { ... on ProjectV2FieldCommon { name } } }
      ... on ProjectV2ItemFieldLabelValue { labels(first: 10) { nodes { name color } } field { ... on ProjectV2FieldCommon { name } } }
      ... on ProjectV2ItemFieldMilestoneValue { milestone { title dueOn } field { ... on ProjectV2FieldCommon { name } } }
      ... on ProjectV2ItemFieldRepositoryValue { repository { name nameWithOwner } field { ... on ProjectV2FieldCommon { name } } }
    }
  }
`;

// ── Markdown formatters ──────────────────────────────────────────────────────

export function formatProject(p: ProjectV2): string {
  const lines: string[] = [
    `## ${p.title} (#${p.number})`,
    `**Owner**: ${p.owner.login} (${p.owner.__typename})`,
    `**URL**: ${p.url}`,
    `**Status**: ${p.closed ? "Closed" : "Open"} | ${p.public ? "Public" : "Private"}`,
    `**Items**: ${p.items.totalCount}`,
    `**Created**: ${p.createdAt} | **Updated**: ${p.updatedAt}`,
  ];
  if (p.shortDescription) lines.push(`**Description**: ${p.shortDescription}`);
  lines.push(`**Node ID**: \`${p.id}\``);

  const fields = p.fields.nodes;
  if (fields.length > 0) {
    lines.push("", "### Fields");
    for (const f of fields) {
      let fieldLine = `- **${f.name}** (${f.dataType}) — ID: \`${f.id}\``;
      if (f.options) {
        const opts = f.options.map((o) => `${o.name} (${o.id})`).join(", ");
        fieldLine += ` — Options: ${opts}`;
      }
      lines.push(fieldLine);
    }
  }
  return lines.join("\n");
}

export function formatItem(item: ProjectV2Item): string {
  const lines: string[] = [`### Item \`${item.id}\``];
  lines.push(`**Type**: ${item.type} | **Archived**: ${item.isArchived}`);

  const c = item.content;
  if (c) {
    if (c.__typename === "DraftIssue") {
      lines.push(`**Title**: ${c.title}`);
      if (c.body) lines.push(`**Body**: ${c.body.slice(0, 200)}${c.body.length > 200 ? "…" : ""}`);
    } else if (c.__typename === "Issue" || c.__typename === "PullRequest") {
      lines.push(`**Title**: [${c.title}](${c.url}) (#${c.number})`);
      lines.push(`**State**: ${c.state}`);
      lines.push(`**Repo**: ${c.repository.nameWithOwner}`);
      if (c.assignees.nodes.length > 0) {
        lines.push(`**Assignees**: ${c.assignees.nodes.map((a) => a.login).join(", ")}`);
      }
    }
  }

  const fieldValues = item.fieldValues.nodes.filter(
    (fv) => fv.__typename !== "ProjectV2ItemFieldTextValue" || fv.text !== undefined
  );
  if (fieldValues.length > 0) {
    lines.push("**Fields**:");
    for (const fv of fieldValues) {
      const fieldName = fv.field?.name ?? "?";
      let value = "";
      if (fv.text !== undefined) value = fv.text;
      else if (fv.number !== undefined) value = String(fv.number);
      else if (fv.date !== undefined) value = fv.date;
      else if (fv.name !== undefined) value = fv.name; // single-select
      else if (fv.title !== undefined) value = `${fv.title} (${fv.startDate})`; // iteration
      else if (fv.users?.nodes) value = fv.users.nodes.map((u) => u.login).join(", ");
      else if (fv.labels?.nodes) value = fv.labels.nodes.map((l) => l.name).join(", ");
      else if (fv.milestone) value = fv.milestone.title;
      else if (fv.repository) value = fv.repository.nameWithOwner;
      if (value) lines.push(`  - ${fieldName}: ${value}`);
    }
  }

  return lines.join("\n");
}

export function formatField(f: ProjectV2Field): string {
  let line = `- **${f.name}** | type: \`${f.dataType}\` | id: \`${f.id}\``;
  if (f.options) {
    line +=
      "\n  Options: " +
      f.options.map((o) => `\`${o.id}\` ${o.name} (${o.color})`).join(", ");
  }
  if (f.configuration) {
    const iters = f.configuration.iterations
      .map((i) => `\`${i.id}\` ${i.title}`)
      .join(", ");
    line += `\n  Active iterations: ${iters}`;
  }
  return line;
}
