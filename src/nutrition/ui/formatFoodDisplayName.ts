/**
 * Display-only formatting of catalog food names (TACO/TBCA/USDA-style
 * comma-separated technical names, e.g. "Frango, peito, sem pele, cozido").
 * Never mutates the canonical `name` — callers must keep passing the
 * original string to search/rank/engine code; only the JSX text changes.
 */

const POULTRY_WORDS = new Set(['frango', 'galinha', 'peru', 'pato']);

function capitalizeFirst(text: string): string {
  if (text.length === 0) return text;
  return text[0].toUpperCase() + text.slice(1);
}

function joinRest(parts: string[]): string {
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function bovineOrSuineAdjective(token: string): string | null {
  if (/^bov/i.test(token)) return 'bovino';
  if (/^su[ií]n/i.test(token)) return 'suíno';
  return null;
}

/**
 * Reorders known TACO/TBCA comma-chain structures (poultry cut, bovine/suine
 * cut, fish fillet) into natural PT-BR phrasing. Anything else — including
 * branded/Open Food Facts names — only gets whitespace/comma cleanup, never
 * reordered, per the "be conservative with commercial names" requirement.
 */
export function formatFoodDisplayName(
  name: string,
  brand?: { name: string; productName?: string } | null,
): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) return trimmed;

  if (brand?.name) {
    return trimmed.replace(/\s+/g, ' ');
  }

  const parts = trimmed.split(',').map((part) => part.trim()).filter((part) => part.length > 0);
  if (parts.length <= 1) return trimmed;

  const category = parts[0].toLowerCase();

  if (parts.length >= 3 && POULTRY_WORDS.has(category)) {
    const corte = capitalizeFirst(parts[1]);
    const modifiers = joinRest(parts.slice(2));
    return `${corte} de ${category}${modifiers ? ` ${modifiers}` : ''}`;
  }

  if (parts.length >= 3 && category === 'carne') {
    const adjective = bovineOrSuineAdjective(parts[1]);
    if (adjective) {
      const corte = capitalizeFirst(parts[2]);
      const modifiers = joinRest(parts.slice(3));
      return `${corte} ${adjective}${modifiers ? ` ${modifiers}` : ''}`;
    }
  }

  if (parts.length >= 3 && category === 'peixe') {
    const especie = parts[1];
    if (/^fil[eé]/i.test(parts[2]) && parts.length >= 4) {
      const preparo = joinRest(parts.slice(3));
      return `Filé de ${especie}${preparo ? ` ${preparo}` : ''}`;
    }
    const preparo = joinRest(parts.slice(2));
    return `${capitalizeFirst(especie)}${preparo ? ` ${preparo}` : ''}`;
  }

  return capitalizeFirst(joinRest(parts));
}
