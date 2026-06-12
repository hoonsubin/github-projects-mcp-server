// =============================================================================
// src/services/session-cache.ts - Per-session caches to avoid repeat API work
// =============================================================================

import type { OrientResult } from "../domain/types.ts";
import type { ScrumConfig } from "../domain/config.ts";
import type { ProjectReader } from "../scrum/ports.ts";
import { orientUseCase } from "../scrum/orient.ts";
import { applyOrientDetail, type OrientDetail } from "../scrum/orient-tier.ts";

export interface OrientRequest {
  readonly detail: OrientDetail;
  readonly refresh: boolean;
}

interface OrientCacheEntry {
  readonly data: OrientResult;
  readonly warnings: readonly string[];
  readonly metadataLoaded: boolean;
}

/**
 * Session-scoped cache: one instance per MCP server (stdio process or HTTP session).
 * Caches orient output and skips reloadMetadata on repeat orient unless refresh=true.
 */
export class SessionCache {
  private orientEntry: OrientCacheEntry | null = null;

  invalidateOrient(): void {
    this.orientEntry = null;
  }

  async orient(
    backend: ProjectReader,
    scrumConfig: ScrumConfig,
    request: OrientRequest,
  ): Promise<{ data: OrientResult; warnings: string[] }> {
    if (!request.refresh && this.orientEntry) {
      return {
        data: applyOrientDetail(this.orientEntry.data, request.detail),
        warnings: [...this.orientEntry.warnings],
      };
    }

    const skipMetadataReload = !!this.orientEntry?.metadataLoaded && !request.refresh;
    const { data, warnings } = await orientUseCase(backend, scrumConfig, {
      skipMetadataReload,
    });

    this.orientEntry = {
      data,
      warnings,
      metadataLoaded: true,
    };

    return {
      data: applyOrientDetail(data, request.detail),
      warnings: [...warnings],
    };
  }
}
