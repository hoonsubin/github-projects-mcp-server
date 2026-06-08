/** Shared types for the test fixture capture pipeline. */

/** Raw GraphQL response for ResolveActorNodeId. */
export interface ResolveActorNodeIdResponse {
  user: { id: string } | null;
}

/** Augmentation config YAML shape. */
export interface AugmentationConfig {
  augmentations: AugmentationEntry[];
}

export interface AugmentationEntry {
  item_key: string;
  append_fields: Record<string, unknown>[];
}

/** Shape of captured item-detail JSON. */
export interface CapturedItemDetail<TNormalized = unknown, TRaw = unknown> {
  normalized: TNormalized;
  raw: TRaw;
  captured_at: string;
}
