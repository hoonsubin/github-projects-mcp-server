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
  if (ts.isArrowFunction(node)) return true;
  if (ts.isFunctionExpression(node)) return true;
  if (ts.isMethodDeclaration(node) && node.name && typeof node.name !== "string") return true;
  return false;
};

const getVariableKind = (list: ts.VariableDeclarationList): ExportKind => {
  const parent = list.parent;
  if (parent && ts.isVariableStatement(parent)) {
    const modifiers = parent.modifiers;
    if (modifiers && Array.isArray(modifiers)) {
      for (const modifier of modifiers) {
        if (modifier.kind === ts.SyntaxKind.ConstKeyword) return "const";
        if (modifier.kind === ts.SyntaxKind.LetKeyword) return "let";
      }
    }
  }
  return "var";
};

// ── ExportParser ───────────────────────────────────────────────────────────────

/**
 * Uses TypeScript Compiler API to extract exports with full type information,
 * and determines whether each export is used internally within the same module.
 */
export class ParsedModule {
  private includeExternal: boolean;

  private imports: ImportInfo[] = [];
  private exports: ExportInfo[] = [];

  /**
   * Set of names that are imported into this module from other modules.
   * Used to avoid false positives when checking internal usage —
   * an identifier that is both imported and has the same name as a local export
   * should not be counted as an internal usage of that export.
   */
  private importedNames: Set<string> = new Set();

  /**
   * Set of names declared at the top level of this module (non-exported).
   * Helps disambiguate shadowed identifiers — if a name matches a local
   * non-exported declaration, usages of that name are not counted as usages
   * of the exported symbol with the same name.
   */
  private topLevelLocalNames: Set<string> = new Set();

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
    this.collectTopLevelLocalNames();

    // Enrich each export with internal usage info
    this.exports = this.exports.map((exp) => ({
      ...exp,
      usedInternally: this.isExportUsedInternally(exp.name),
    }));
  }

  // ── Public API ──────────────────────────────────────────────────────────────

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

  /**
   * Returns true if the given export name is referenced at least once
   * within this module outside of its own declaration and export sites.
   */
  public isExportUsedInternally(exportName: string): boolean {
    // Guard 1: if this name was brought in via an import, any usage of the
    // identifier refers to the imported binding, not a local export.
    if (this.importedNames.has(exportName)) return false;

    return this.findInternalUsages(exportName).length > 0;
  }

  // ── Private: Internal Usage Detection ──────────────────────────────────────

  /**
   * Walks the entire AST looking for Identifier nodes matching `name`,
   * excluding declaration sites and export sites.
   */
  private findInternalUsages(name: string): ts.Node[] {
    const usages: ts.Node[] = [];

    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node) && node.text === name) {
        if (!this.isDeclarationSite(node) && !this.isExportSite(node)) {
          usages.push(node);
        }
      }
      ts.forEachChild(node, visit);
    };

    ts.forEachChild(this.moduleSourceFile, visit);
    return usages;
  }

  /**
   * Returns true if `identifier` is the name node of its own declaration.
   * Covers: function, class, type alias, interface, enum, variable declarations.
   */
  private isDeclarationSite(identifier: ts.Identifier): boolean {
    const parent = identifier.parent;
    if (!parent) return false;

    if (
      ts.isFunctionDeclaration(parent) ||
      ts.isClassDeclaration(parent) ||
      ts.isTypeAliasDeclaration(parent) ||
      ts.isInterfaceDeclaration(parent) ||
      ts.isEnumDeclaration(parent)
    ) {
      return parent.name === identifier;
    }

    // const/let/var foo = ...
    if (ts.isVariableDeclaration(parent)) {
      return parent.name === identifier;
    }

    // Arrow or function expression assigned to a variable:
    // `const foo = () => {}` — the VariableDeclaration name is handled above,
    // but the identifier could also appear as a parameter name inside the function.
    // Parameters are not a declaration site for the export — only the binding name is.
    if (ts.isParameter(parent)) {
      return false;
    }

    return false;
  }

  /**
   * Returns true if `identifier` appears inside an export clause or assignment,
   * meaning it is not a real "usage" of the symbol — just a re-declaration of its
   * public surface.
   *
   * Covers:
   *  - `export { foo }`           → ExportSpecifier
   *  - `export { foo as bar }`    → ExportSpecifier (both name and propertyName)
   *  - `export default foo`       → ExportAssignment
   *  - `export * as foo from ...` → NamespaceExport (re-export alias, no local usage)
   */
  private isExportSite(identifier: ts.Identifier): boolean {
    const parent = identifier.parent;
    if (!parent) return false;

    // export { foo } or export { localFoo as foo }
    if (ts.isExportSpecifier(parent)) return true;

    // export default foo
    if (ts.isExportAssignment(parent)) return true;

    // export * as foo from '...' — the alias is a NamespaceExport child
    if (ts.isNamespaceExport(parent)) return true;

    // Also guard against inline export keyword on the declaration node itself.
    // e.g. the `foo` in `export function foo() {}` — already caught by isDeclarationSite,
    // but also has an ExportKeyword modifier on the FunctionDeclaration parent.
    // This is handled by isDeclarationSite above; no double-counting occurs.

    return false;
  }

  // ── Private: Name Collection ────────────────────────────────────────────────

  /**
   * Collects all names imported into this module (from any source).
   * These names are stored in `importedNames` to prevent false positives
   * where an imported binding shares a name with a local export.
   *
   * Example false positive without this guard:
   *   import { helper } from './utils';  // imported
   *   export function helper() {}        // local export (different binding)
   *   const x = helper();               // usage — but of which `helper`?
   *
   * Without the guard, `helper` would appear as "used internally".
   * With the guard, we skip the check entirely because `helper` is also imported,
   * making disambiguation impossible without a type checker.
   */
  private buildImportedNamesSet(): void {
    for (const imp of this.imports) {
      this.importedNames.add(imp.name);
      if (imp.alias) this.importedNames.add(imp.alias);
    }
  }

  /**
   * Collects all top-level declaration names that are NOT exported.
   * Used to detect shadowing: if a non-exported local shares the name of an export,
   * identifier usages in the file are ambiguous without a type checker.
   *
   * We still proceed with usage detection in this case, but this set can be
   * consulted by callers to flag results as "possibly shadowed".
   *
   * Example:
   *   export function format() { ... }  // export
   *   function format(x: string) { ... } // non-exported shadow — ambiguous usages
   */
  private collectTopLevelLocalNames(): void {
    ts.forEachChild(this.moduleSourceFile, (node) => {
      if (hasExportKeyword(node)) return; // skip exported declarations

      if (
        ts.isFunctionDeclaration(node) ||
        ts.isClassDeclaration(node) ||
        ts.isTypeAliasDeclaration(node) ||
        ts.isInterfaceDeclaration(node) ||
        ts.isEnumDeclaration(node)
      ) {
        if (node.name) this.topLevelLocalNames.add(node.name.text);
      }

      if (ts.isVariableStatement(node)) {
        for (const decl of node.declarationList.declarations) {
          if (ts.isIdentifier(decl.name)) {
            this.topLevelLocalNames.add(decl.name.text);
          }
        }
      }
    });
  }

  /**
   * Returns true if an export name is shadowed by a non-exported top-level
   * declaration with the same name. In this case, `isExportUsedInternally`
   * may produce false positives even after import filtering.
   */
  public isNameShadowedLocally(exportName: string): boolean {
    return this.topLevelLocalNames.has(exportName);
  }

  // ── Private: AST Parsers ────────────────────────────────────────────────────

  private parseImports = (node: ts.Node): void => {
    if (!ts.isImportDeclaration(node)) return;

    const specifier = node.moduleSpecifier;
    if (!specifier || !ts.isStringLiteral(specifier)) return;

    const modulePath = specifier.text;
    if (!modulePath.startsWith(".") && !this.includeExternal) return;

    if (
      node.importClause?.namedBindings &&
      ts.isNamedImports(node.importClause.namedBindings)
    ) {
      for (const binding of node.importClause.namedBindings.elements) {
        if (ts.isImportSpecifier(binding)) {
          const name = binding.name.text;
          const alias = binding.propertyName?.text;
          this.imports.push({ name, kind: "named", alias, path: modulePath });
          // Register both the local binding name and the original name as imported
          this.importedNames.add(name);
          if (alias) this.importedNames.add(alias);
        }
      }
    }

    if (node.importClause?.name) {
      const name = node.importClause.name.text;
      this.imports.push({ name, kind: "default", path: modulePath });
      this.importedNames.add(name);
    }

    if (
      node.importClause?.namedBindings &&
      ts.isNamespaceImport(node.importClause.namedBindings)
    ) {
      const name = node.importClause.namedBindings.name.text;
      this.imports.push({ name, kind: "namespace", path: modulePath });
      this.importedNames.add(name);
    }
  };

  private parseExports = (node: ts.Node): void => {
    if (!hasExportKeyword(node)) return;

    if (ts.isClassDeclaration(node)) {
      this.exports.push({ name: node.name?.text ?? "anonymous", kind: "class" });
    }

    if (ts.isFunctionDeclaration(node)) {
      const returnType = this.getReturnTypeText(node);
      this.exports.push({
        name: node.name?.text ?? "anonymous",
        kind: "function",
        returnType,
      });
    }

    if (ts.isInterfaceDeclaration(node)) {
      this.exports.push({ name: node.name.text, kind: "interface" });
    }

    if (ts.isTypeAliasDeclaration(node)) {
      const type = node.type.getText().trim();
      this.exports.push({ name: node.name.text, kind: "type", type });
    }

    if (ts.isEnumDeclaration(node)) {
      this.exports.push({ name: node.name.text, kind: "enum" });
    }

    if (ts.isVariableStatement(node)) {
      const list = node.declarationList;
      const kind = getVariableKind(list);
      for (const decl of list.declarations) {
        const type = decl.type?.getText().trim();
        let finalKind = kind;
        if (decl.initializer && isFunctionExpression(decl.initializer)) {
          finalKind = "function";
        }
        this.exports.push({
          name: decl.name.getText().trim(),
          kind: finalKind,
          type,
        });
      }
    }
  };

  private getReturnTypeText(node: ts.FunctionDeclaration): string | undefined {
    return node.type?.getText().trim();
  }
}
