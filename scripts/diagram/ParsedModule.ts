import * as ts from "typescript";
import { ExportInfo, ExportKind, ImportInfo } from "./types.ts";
import * as path from "@std/path";

// ── Helpers ────────────────────────────────────────────────────────────────────

const hasExportKeyword = (node: ts.Node): boolean => {
  const modifiers = (node as unknown as { modifiers?: unknown[] }).modifiers;
  if (!modifiers || !Array.isArray(modifiers)) return false;
  return modifiers.some(
    (m: unknown) => (m as { kind?: number }).kind === ts.SyntaxKind.ExportKeyword,
  );
};

const isFunctionExpression = (node: ts.Node): boolean => {
  // Check for arrow function expressions
  if (ts.isArrowFunction(node)) {
    return true;
  }

  // Check for function expressions (e.g., `const func = function() {}`)
  if (ts.isFunctionExpression(node)) {
    return true;
  }

  // Check for object method shorthand (e.g., `{ method() {} }`)
  if (ts.isMethodDeclaration(node) && node.name && typeof node.name !== "string") {
    return true;
  }

  return false;
};

const getVariableKind = (
  list: ts.VariableDeclarationList,
): ExportKind => {
  // More robust way to check for modifiers - look at the parent node
  const parent = list.parent;
  if (parent && ts.isVariableStatement(parent)) {
    const modifiers = parent.modifiers;
    if (modifiers && Array.isArray(modifiers)) {
      for (const modifier of modifiers) {
        if (modifier.kind === ts.SyntaxKind.ConstKeyword) {
          return "const";
        }
        if (modifier.kind === ts.SyntaxKind.LetKeyword) {
          return "let";
        }
      }
    }
  }
  return "var";
};

// ── ExportParser ───────────────────────────────────────────────────────────────

/**
 * Uses TypeScript Compiler API to extract exports with full type information.
 */
export class ParsedModule {
  // includes parsing external imports or not
  private includeExternal: boolean;

  private imports: ImportInfo[] = [];
  private exports: ExportInfo[] = [];

  private moduleSourceFile: ts.SourceFile;

  constructor(
    public filePathName: string,
    public moduleBody: string,
    includeExternal: boolean = false,
  ) {
    this.filePathName = filePathName;
    this.moduleBody = moduleBody;
    this.includeExternal = includeExternal;
    const modSource = ts.createSourceFile(
      filePathName,
      moduleBody,
      ts.ScriptTarget.Latest,
      true,
    );

    this.moduleSourceFile = modSource;

    ts.forEachChild(modSource, this.parseImports);
    ts.forEachChild(modSource, this.parseExports);
  }

  public getModuleSource() {
    return this.moduleSourceFile;
  }

  public getMermaidClassName() {
    return path.basename(this.filePathName);
  }

  public getParentFolderName() {
    return path.basename(path.dirname(this.filePathName));
  }

  public getExports() {
    return this.exports;
  }

  public getImports() {
    return this.imports;
  }

  // Find all import declarations in the file
  private parseImports = (node: ts.Node): void => {
    if (!ts.isImportDeclaration(node)) return;
    const specifier = node.moduleSpecifier;
    // Check if this import declaration matches our target path
    if (specifier && ts.isStringLiteral(specifier)) {
      // Handle different types of import clauses

      const modulePath = specifier.text;
      // Named imports (e.g., { Foo, Bar })

      // Escape if it's not an internal module and the object doesn't include externals
      if (!modulePath.startsWith(".") && !this.includeExternal) return;

      if (
        node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)
      ) {
        const namedImports = node.importClause.namedBindings;

        for (const binding of namedImports.elements) {
          if (ts.isImportSpecifier(binding)) {
            const name = binding.name.text;

            // Handle "as" aliases (e.g., { Foo as Bar })
            const alias = binding.propertyName?.text;

            // For simplicity, we'll treat all named imports as "named"
            // and let the caller handle type distinction if needed
            this.imports.push({
              name,
              kind: "named",
              alias,
              path: modulePath,
            });
          }
        }
      }

      // Default import (e.g., Foo)
      if (node.importClause?.name) {
        this.imports.push({
          name: node.importClause.name.text,
          kind: "default",
          path: modulePath,
        });
      }

      // Namespace import (e.g., * as Foo)
      if (
        node.importClause?.namedBindings &&
        ts.isNamespaceImport(node.importClause.namedBindings)
      ) {
        const namespaceImport = node.importClause.namedBindings;
        this.imports.push({
          name: namespaceImport.name.text,
          kind: "namespace",
          path: modulePath,
        });
      }
    }
  };

  private parseExports = (
    node: ts.Node,
  ): void => {
    if (!hasExportKeyword(node)) return;

    if (ts.isClassDeclaration(node)) {
      this.exports.push({
        name: node.name?.text ?? "anonymous",
        kind: "class",
      });
    }

    if (ts.isFunctionDeclaration(node)) {
      const returnType = this.getReturnTypeText(node);
      this.exports.push({
        name: node.name?.text ?? "anonymous",
        // todo: also get the function parameters
        kind: "function",
        returnType,
      });
    }

    if (ts.isInterfaceDeclaration(node)) {
      this.exports.push({
        name: node.name.text,
        kind: "interface",
      });
    }

    if (ts.isTypeAliasDeclaration(node)) {
      const type = node.type.getText().trim();
      this.exports.push({
        name: node.name.text,
        kind: "type",
        type,
      });
    }

    if (ts.isEnumDeclaration(node)) {
      this.exports.push({
        name: node.name.text,
        kind: "enum",
      });
    }

    if (ts.isVariableStatement(node)) {
      const list = node.declarationList;
      const kind = getVariableKind(list);
      for (const decl of list.declarations) {
        const type = decl.type?.getText().trim();

        // Check if this is a function expression assigned to a variable
        let finalKind = kind;
        if (decl.initializer) {
          if (isFunctionExpression(decl.initializer)) {
            // todo: also get the function parameters
            finalKind = "function";
          }
        }

        this.exports.push({
          name: decl.name.getText().trim(),
          kind: finalKind,
          type,
        });
      }
    }
  };

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
