import { rangesOverlap } from '../lib/dates.js';

/**
 * Contract rules.
 *
 * Pure, so the overlap rule can be tested without a database. The rule the
 * problem statement states is that one employee must not hold two running
 * contracts covering the same period: payroll would then have no single answer
 * to "what is this person's wage for February".
 */

/**
 * Finds running contracts whose period overlaps the candidate.
 *
 * `existing` are that employee's other contracts. Only running contracts
 * conflict — a draft is not yet in force, and an expired one is history.
 */
export function overlappingContracts(candidate, existing = []) {
  if (candidate.status !== 'RUNNING') return [];

  return existing.filter(
    (other) =>
      other.id !== candidate.id &&
      other.status === 'RUNNING' &&
      rangesOverlap(candidate.startDate, candidate.endDate, other.startDate, other.endDate)
  );
}

/** Returns a message when the contract's own dates are inconsistent. */
export function validatePeriod(startDate, endDate) {
  if (endDate && endDate.getTime() < startDate.getTime()) {
    return 'The end date cannot be before the start date.';
  }
  return null;
}

/**
 * The status a contract should have on a given day.
 *
 * Used to expire contracts whose end date has passed, so a list is not full of
 * contracts still labelled "Running" months after they ended.
 */
export function statusOn(contract, today) {
  if (contract.status === 'DRAFT') return 'DRAFT';
  if (contract.endDate && contract.endDate.getTime() < today.getTime()) return 'EXPIRED';
  return contract.status;
}

/**
 * The contract that applies to a payroll period.
 *
 * Payroll asks this rather than "the latest contract": the one that matters is
 * the running contract covering the period, and when several qualify the most
 * recently started one wins.
 */
export function contractForPeriod(contracts, periodStart, periodEnd) {
  const applicable = contracts
    .filter(
      (contract) =>
        contract.status !== 'DRAFT' &&
        rangesOverlap(contract.startDate, contract.endDate, periodStart, periodEnd)
    )
    .sort((a, b) => b.startDate.getTime() - a.startDate.getTime());

  return applicable[0] ?? null;
}
