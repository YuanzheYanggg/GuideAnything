import { getLastGoodPromptHarness } from '../knowledge/vault-indexer';

export interface TrustedSantexwellHarness {
  revision: string;
  items: readonly string[];
}

/**
 * Returns only the vault indexer's already validated, allowlisted last-good
 * bundle. This adapter never reads a caller-supplied path itself.
 */
export function getTrustedSantexwellHarness(vaultRoot: string): TrustedSantexwellHarness | null {
  const bundle = getLastGoodPromptHarness(vaultRoot);
  if (!bundle) return null;
  return { revision: bundle.revision, items: [bundle.content] };
}
