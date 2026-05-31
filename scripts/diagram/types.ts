export interface UnusedExport extends ExportInfo {
  modulePathName: string;
}

export interface ExportInfo {
  name: string;
  kind: ExportKind;
  type?: string;
  returnType?: string;
}

export interface ImportInfo {
  name: string;
  kind: ImportKind;
  path: string;
  alias?: string;
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

export type ImportKind =
  | "named"
  | "default"
  | "namespace"
  | "type";
