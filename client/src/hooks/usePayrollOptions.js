import { api } from '../api/client.js';
import { useResource } from './useResource.js';

/** The active salary structures, for the rule form and the payrun wizard. */
export function useStructures() {
  const { data, loading, error, refetch } = useResource(
    (signal) => api.get('/payroll/structure-options', { signal }),
    []
  );

  return { loading, error, refetch, structures: data?.items ?? [] };
}

/** How a rule's category reads, and what colour it carries. */
export const RULE_CATEGORIES = [
  { value: 'BASIC', label: 'Basic' },
  { value: 'ALLOWANCE', label: 'Allowance' },
  { value: 'GROSS', label: 'Gross' },
  { value: 'DEDUCTION', label: 'Deduction' },
  { value: 'NET', label: 'Net' },
];

export const COMPUTATIONS = [
  { value: 'FIXED', label: 'Fixed Amount' },
  { value: 'PERCENTAGE', label: 'Percentage of a base' },
  { value: 'FORMULA', label: 'Formula' },
];

export const PERCENTAGE_BASES = [
  { value: 'CONTRACT_WAGE', label: 'Contract Wage' },
  { value: 'BASIC', label: 'Basic Salary' },
  { value: 'GROSS', label: 'Gross Salary' },
];

export function categoryLabel(value) {
  return RULE_CATEGORIES.find((category) => category.value === value)?.label ?? value;
}

export function computationLabel(value) {
  return COMPUTATIONS.find((computation) => computation.value === value)?.label ?? value;
}

/** Badge colour per payrun or payslip status. */
export function payrollStatusTone(status) {
  switch (status) {
    case 'PAID':
      return 'success';
    case 'VALIDATED':
      return 'info';
    case 'COMPUTED':
    case 'DONE':
      return 'info';
    case 'DRAFT':
      return 'default';
    default:
      return 'default';
  }
}

export function payrollStatusLabel(status) {
  switch (status) {
    case 'TO_APPROVE':
      return 'To Approve';
    default:
      return status ? status.charAt(0) + status.slice(1).toLowerCase() : '—';
  }
}
