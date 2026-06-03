// =============================================================================
// platform-request.ts — Executable GraphQL request payload (document + variables)
//
// Leaf module used by ExecutionEngine and pagination without depending on
// assembler pipeline types (FilterProfile, AssemblerOutput).
// =============================================================================

export interface PlatformRequest {
  readonly document: string;
  readonly variables: Record<string, unknown>;
  readonly operationName?: string;
}
