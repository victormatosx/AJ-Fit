export type MultiSelectionOptions = {
  exclusiveOption?: string;
  maxSelections?: number;
};

/**
 * Pure selection transition shared by questionnaire multi-select controls.
 * It preserves the persisted option ids and exclusive-option behavior.
 */
export function toggleMultiSelection(
  value: string[],
  toggledValue: string,
  { exclusiveOption, maxSelections }: MultiSelectionOptions = {},
): string[] {
  if (value.includes(toggledValue)) {
    return value.filter((item) => item !== toggledValue);
  }
  if (toggledValue === exclusiveOption) return [toggledValue];

  const withoutExclusive = exclusiveOption
    ? value.filter((item) => item !== exclusiveOption)
    : value;
  if (maxSelections != null && withoutExclusive.length >= maxSelections) return value;
  return [...withoutExclusive, toggledValue];
}
