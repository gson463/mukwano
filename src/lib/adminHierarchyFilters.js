/**
 * Admin UI: filter chains Branch → Center → Group (same mental model as manager/officer, system-wide data).
 */

export function resolveBorrowerCenterId(borrower, groups) {
  if (!borrower) return null;
  if (borrower.center_id) return borrower.center_id;
  if (borrower.group_id) {
    return groups.find((g) => g.id === borrower.group_id)?.center_id ?? null;
  }
  return null;
}

/** Centers shown in the Center dropdown. */
export function adminCentersForSelect(centers, branchFilter) {
  if (branchFilter === 'all') return centers;
  if (branchFilter === 'none') return [];
  return centers.filter((c) => c.branch_id === branchFilter);
}

/**
 * Groups in the Group dropdown, given current branch and center filters.
 */
export function adminGroupsForSelect(groups, centers, branchFilter, centerFilter) {
  const inBranch = (g) => {
    if (branchFilter === 'all') return true;
    if (branchFilter === 'none') return false;
    const c = centers.find((x) => x.id === g.center_id);
    return c?.branch_id === branchFilter;
  };
  let list = groups.filter(inBranch);
  if (centerFilter !== 'all') {
    list = list.filter((g) => g.center_id === centerFilter);
  }
  return list;
}

/**
 * For admin loan list: optionally narrow groups when officer is set (officer + center + group chain).
 * Same pattern as manager/LoanManagement.
 */
export function adminGroupsForLoanTable(groups, centerFilter, officerFilter) {
  if (officerFilter === 'all') {
    if (centerFilter === 'all') return groups;
    return groups.filter((g) => g.center_id === centerFilter);
  }
  if (centerFilter === 'all') {
    return groups.filter((g) => g.loan_officer_id === officerFilter);
  }
  return groups.filter(
    (g) => g.center_id === centerFilter && g.loan_officer_id === officerFilter,
  );
}
