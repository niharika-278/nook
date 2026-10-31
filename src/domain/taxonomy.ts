const CATEGORY_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  "personal portfolio": "Portfolio",
  "personal website": "Portfolio",
  "portfolio site": "Portfolio",
  "portfolio website": "Portfolio",
  "professional portfolio": "Portfolio",
});

const TAG_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  "react.js": "react",
  reactjs: "react",
  "node.js": "node",
  nodejs: "node",
});

export function normalizeLabel(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ");
}

export function labelKey(value: string): string {
  return normalizeLabel(value).toLocaleLowerCase();
}

export function tagKey(value: string): string {
  const key = labelKey(value);
  return TAG_ALIASES[key] ?? key;
}

export function categoryKey(value: string): string {
  const key = labelKey(value);
  return labelKey(CATEGORY_ALIASES[key] ?? key);
}

export function canonicalCategoryName(value: string): string {
  const normalized = normalizeLabel(value);
  return CATEGORY_ALIASES[labelKey(normalized)] ?? normalized;
}

export function isFallbackCategory(value: string | null | undefined): boolean {
  return value !== null && value !== undefined && categoryKey(value) === "uncategorized";
}

export interface CategoryCandidate {
  name: string | null;
  additionalTags: string[];
}

export function resolveCategoryCandidate(candidate: string | null | undefined, existingNames: readonly string[]): CategoryCandidate {
  if (!candidate?.trim()) return { name: null, additionalTags: [] };
  const normalizedCandidate = normalizeLabel(candidate);
  const candidateKey = categoryKey(normalizedCandidate);
  const matchingExisting = existingNames.find((name) => categoryKey(name) === candidateKey);
  if (matchingExisting) {
    const additionalTags = candidateKey !== labelKey(normalizedCandidate) ? [normalizedCandidate] : [];
    return { name: normalizeLabel(matchingExisting), additionalTags };
  }

  const hierarchy = normalizedCandidate.split(/\s*(?::|\/|>|—|–)\s*/, 2);
  if (hierarchy.length === 2) {
    const parent = existingNames.find((name) => categoryKey(name) === categoryKey(hierarchy[0] ?? ""));
    if (parent && hierarchy[1]) {
      return { name: normalizeLabel(parent), additionalTags: [normalizeLabel(hierarchy[1])] };
    }
  }

  const canonical = canonicalCategoryName(normalizedCandidate);
  return {
    name: canonical,
    additionalTags: canonical !== normalizedCandidate ? [normalizedCandidate] : [],
  };
}

export function categoryAliasKey(value: string): string | null {
  const key = labelKey(value);
  const canonicalKeys = new Set(Object.values(CATEGORY_ALIASES).map(categoryKey));
  return CATEGORY_ALIASES[key] || canonicalKeys.has(categoryKey(value)) ? categoryKey(value) : null;
}
