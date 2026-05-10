// =============================================================================
// scripts/diagram/ExportParser.ts — Extract exports with type info via TS Compiler API
// =============================================================================

import * as ts from "typescript";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ExportInfo {
  name: string;
  kind: ExportKind;
  type?: string;
  returnType?: string;
}

export type ExportKind =
  | "class"
  | "function"
  | "interface"
  | "type"
  | "enum"
  | "const"
  | "let"
  | "var"
  | "module";

// ── Helpers ────────────────────────────────────────────────────────────────────

const hasExportKeyword = (node: ts.Node): boolean => {
  const modifiers = (node as unknown as { modifiers?: unknown[] }).modifiers;
  if (!modifiers || !Array.isArray(modifiers)) return false;
  return modifiers.some(
    (m: unknown) => (m as { kind?: number }).kind === ts.SyntaxKind.ExportKeyword,
  );
};

const getVariableKind = (
  list: ts.VariableDeclarationList,
): ExportKind => {
  const modifiers = (list as unknown as { modifiers?: unknown[] }).modifiers;
  if (modifiers && Array.isArray(modifiers)) {
    if (
      modifiers.some(
        (m: unknown) => (m as { kind?: number }).kind === ts.SyntaxKind.ConstKeyword,
      )
    ) {
      return "const";
    }
    if (
      modifiers.some(
        (m: unknown) => (m as { kind?: number }).kind === ts.SyntaxKind.LetKeyword,
      )
    ) {
      return "let";
    }
  }
  return "var";
};

// ── ExportParser ───────────────────────────────────────────────────────────────

/**
 * Uses TypeScript Compiler API to extract exports with full type information.
 */
export class ExportParser {
  parse(content: string, filePath: string): ExportInfo[] {
    const sourceFile = ts.createSourceFile(
      filePath,
      content,
      ts.ScriptTarget.Latest,
      true,
    );

    const exports: ExportInfo[] = [];

    const visit = (node: ts.Node): void => {
      const exportInfo = this.extractExportInfo(node, exports);
      if (exportInfo) {
        exports.push(exportInfo);
      }
      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    return exports;
  }

  private extractExportInfo(
    node: ts.Node,
    exports: ExportInfo[],
  ): ExportInfo | null {
    if (!hasExportKeyword(node)) return null;

    if (ts.isClassDeclaration(node)) {
      return {
        name: node.name?.text ?? "anonymous",
        kind: "class",
      };
    }

    if (ts.isFunctionDeclaration(node)) {
      const returnType = this.getReturnTypeText(node);
      return {
        name: node.name?.text ?? "anonymous",
        kind: "function",
        returnType,
      };
    }

    if (ts.isInterfaceDeclaration(node)) {
      return {
        name: node.name.text,
        kind: "interface",
      };
    }

    if (ts.isTypeAliasDeclaration(node)) {
      const type = node.type.getText().trim();
      return {
        name: node.name.text,
        kind: "type",
        type,
      };
    }

    if (ts.isEnumDeclaration(node)) {
      return {
        name: node.name.text,
        kind: "enum",
      };
    }

    if (ts.isVariableStatement(node)) {
      const list = node.declarationList;
      const kind = getVariableKind(list);
      for (const decl of list.declarations) {
        const type = decl.type?.getText().trim();
        exports.push({
          name: decl.name.getText().trim(),
          kind,
          type,
        });
      }
    }

    return null;
  }

  private getReturnTypeText(
    node: ts.FunctionDeclaration,
  ): string | undefined {
    const typeNode = node.type;
    if (typeNode) {
      return typeNode.getText().trim();
    }
    return undefined;
  }
}
