/** When true, login is blocked and the subscription paywall message is shown. */
export const SUBSCRIPTION_LOCKED =
  import.meta.env.VITE_SUBSCRIPTION_LOCKED === 'true';

export const SUBSCRIPTION_LOCK_MESSAGE =
  'Failed to load data. Please settle your subscription invoice.';

export const SUBSCRIPTION_LOCK_STATUS_SHORT =
  'Failed to load data · Please settle your subscription invoice';

export const SUBSCRIPTION_LOCK_DETAIL =
  'Access is temporarily suspended until your subscription invoice is settled.';
