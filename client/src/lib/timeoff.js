/**
 * How time off statuses read and colour on screen.
 *
 * Kept in one place so "TO_APPROVE" is never spelled out as three different
 * labels across the request list, the allocation list and the employee form.
 */

const LABELS = {
  TO_APPROVE: 'To Approve',
  APPROVED: 'Approved',
  REFUSED: 'Refused',
  CANCELLED: 'Cancelled',
};

export function timeOffStatusLabel(status) {
  return LABELS[status] ?? status;
}

export function timeOffStatusTone(status) {
  switch (status) {
    case 'APPROVED':
      return 'success';
    case 'TO_APPROVE':
      return 'warning';
    case 'REFUSED':
      return 'danger';
    default:
      return 'default';
  }
}
