export function resolvePrimarySourceIndex(sources, primaryDisplayId) {
  const list = Array.isArray(sources) ? sources : [];
  const expected = String(primaryDisplayId ?? '');
  const matchedIndex = list.findIndex(
    source => expected && String(source?.display_id ?? '') === expected,
  );
  return matchedIndex >= 0 ? matchedIndex : (list.length > 0 ? 0 : -1);
}
