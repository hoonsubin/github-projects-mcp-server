// =============================================================================
// Fixture manifest v2 — wire response index + scenario port snapshots.
// =============================================================================

export interface WireResponseEntry {
  readonly hash: string;
  readonly operation: string;
  readonly variables: Record<string, unknown>;
  readonly file: string;
}

export interface ScenarioManifestEntry {
  readonly callLog: string;
  readonly portOutput: string;
  readonly handlerOutput?: string;
}

export interface FixtureCatalog {
  readonly sampleItemRef: { readonly id: string; readonly key: string } | null;
  readonly sampleDraftRef: { readonly id: string; readonly key: string } | null;
  readonly activeSprintId: string | null;
  readonly owner: string;
  readonly projectNumber: number;
  readonly primaryRepo: string;
}

export interface FixtureManifestV2 {
  readonly version: 2;
  readonly capturedAt: string;
  readonly platform: string;
  readonly owner: string;
  readonly projectNumber: number;
  readonly wire: {
    readonly responses: WireResponseEntry[];
  };
  readonly scenarios: Record<string, ScenarioManifestEntry>;
  readonly catalog: FixtureCatalog;
  /** Legacy flat file list for human review (relative paths). */
  readonly files: string[];
}

export interface ScenarioCallLogEntry {
  readonly hash: string;
  readonly operation: string;
  readonly variables: Record<string, unknown>;
  readonly file: string;
}
