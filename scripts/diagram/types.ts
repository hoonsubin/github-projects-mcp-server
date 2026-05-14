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

/**
 * Represents the architectural layers of the system.
 */
export enum Layer {
  FRAMEWORK = "Framework",
  USE_CASE = "Use-Case",
  ADAPTER = "Adapter",
  OTHER = "Other",
}

/**
 * Configuration for mapping directory prefixes to architectural layers.
 */
export interface LayerMapping {
  [prefix: string]: Layer;
}

export interface ClassDiagramOptions {
  showUnusedExports?: boolean;
  showDependencyArrows?: boolean;
  colorPalette?: readonly string[];
  showNameSpaces?: boolean;
  layerMapping?: LayerMapping;
}
