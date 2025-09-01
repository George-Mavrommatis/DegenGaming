import type { ProfileData } from "../types/profile";

export function getArcadeFreeEntryTokens(profile: ProfileData | null | undefined): number {
  if (!profile) return 0;
  // Check plural first, then singular
  if (typeof profile.freeEntryTokens?.arcadeTokens === 'number')
    return profile.freeEntryTokens.arcadeTokens;
  if (typeof profile.freeEntryTokens?.arcade === 'number')
    return profile.freeEntryTokens.arcade;
  return 0;
}