// Small rules for adding a company (from sign-up or the platform console).

/** Company prefix as stored: uppercase letters and digits, at most 10. */
export const cleanPrefix = (v: unknown) =>
  String(v ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 10);

/**
 * Prefixes to try for a company name, best first: the initials of a
 * multi-word name ("Ek Plate Parcels" → EPP), else the first letters of one
 * word ("Kalyani" → KALY); then the same with 2, 3 … appended.
 */
export function prefixCandidates(name: string, count = 30): string[] {
  const words = String(name || '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  let base = words.length > 1 ? words.map((w) => w[0]).join('') : (words[0] || '').slice(0, 4);
  base = base.slice(0, 6) || 'CO';
  const out = [base];
  for (let i = 2; out.length < count; i++) out.push(`${base}${i}`.slice(0, 10));
  return out;
}

/** The checks a new company's first Admin must pass; null when fine. */
export function adminProblem(a: { first_name?: string; email?: string; password?: string }): string | null {
  if (!String(a.first_name || '').trim()) return "Enter the Admin's first name";
  const email = String(a.email || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Enter a valid email address';
  if (String(a.password || '').length < 8) return 'The password needs at least 8 characters';
  return null;
}

export const companyNameProblem = (name: unknown): string | null => {
  const n = String(name ?? '').trim();
  if (n.length < 2) return 'Enter the business name';
  if (n.length > 150) return 'Keep the business name under 150 characters';
  return null;
};
