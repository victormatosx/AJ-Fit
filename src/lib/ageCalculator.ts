/**
 * Single source of truth for turning a birth date into an age. Every place
 * in the app that needs "how old is this user" — Avaliação Física, the JP3/
 * JP7 calculators, anything future — must go through `computeAge` instead of
 * doing its own year subtraction.
 */

/**
 * Age in whole years at `referenceDate`, using the standard "has the
 * birthday happened yet this year" rule (someone born 15/03/2000 is 24 on
 * 14/03/2024 and 25 on 15/03/2024).
 */
export function computeAge(birthDate: Date, referenceDate: Date = new Date()): number {
  let age = referenceDate.getFullYear() - birthDate.getFullYear();
  const monthDiff = referenceDate.getMonth() - birthDate.getMonth();
  const dayDiff = referenceDate.getDate() - birthDate.getDate();
  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) age--;
  return age;
}

/**
 * Backward-compat only: approximates a birth date from a legacy `age` value
 * that was captured at `referenceDate` (the questionnaire's `createdAt`, not
 * "today" — see src/services/userProfile.ts). Anchoring to the date the age
 * was actually true means `computeAge(result, referenceDate) === age`
 * exactly, and the derived age correctly keeps increasing in the years
 * since, instead of being frozen forever at the original value.
 *
 * Never used for new data — only to read pre-migration questionnaires that
 * have `age` but no `birthDate`.
 */
export function birthDateFromLegacyAge(age: number, referenceDate: Date): Date {
  const d = new Date(referenceDate);
  d.setFullYear(d.getFullYear() - age);
  return d;
}
