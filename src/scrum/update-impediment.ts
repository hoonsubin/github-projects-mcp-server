// =============================================================================
// src/scrum/update-impediment.ts - updateImpedimentUseCase
//
// Updates an impediment's status and optionally adds resolution notes.
// =============================================================================

import type { ImpedimentListing, ImpedimentPort } from "./ports.ts";
import type { ImpedimentRef } from "../domain/types.ts";

export const updateImpedimentUseCase = async (
  backend: ImpedimentPort,
  ref: ImpedimentRef,
  status: "open" | "in_progress" | "resolved",
  resolutionNotes?: string,
): Promise<ImpedimentListing> => {
  // Delegate to backend; the use case itself is thin
  const result = await backend.updateImpediment(ref, status, resolutionNotes);
  return result;
};
