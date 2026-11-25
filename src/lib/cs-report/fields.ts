/**
 * CS Report columns, shared by the daily form, the workbook parser, the
 * dashboard and the Excel export. Order = the Weekly Work List column order
 * (C..P in the current workbook, after Date and Name).
 */
export const CHANNEL_FIELDS = [
  { key: 'imReception', column: 'im_reception', label: 'IM Reception', short: 'IM', excel: 'IM Reception', notesChannel: 'CRM/IM' },
  { key: 'emailReception', column: 'email_reception', label: 'E-mail Reception', short: 'Email', excel: 'E-mail Reception', notesChannel: 'Email' },
  { key: 'waBusinessReception', column: 'wa_business_reception', label: 'WA Business Reception', short: 'WA Business', excel: 'WA Bussiness Reception', notesChannel: 'WA Bussiness' },
  { key: 'socialMediaReception', column: 'social_media_reception', label: 'Social Media Reception', short: 'Social Media', excel: 'Social Media Reception', notesChannel: 'Social Media' },
  { key: 'callReception', column: 'call_reception', label: 'Call Reception', short: 'Call', excel: 'Call Reception', notesChannel: 'Call' },
] as const;

export const CATEGORY_FIELDS = [
  { key: 'accountProblem', column: 'account_problem', label: 'Account Problem', excel: 'Account Problem' },
  { key: 'depositWithdraw', column: 'deposit_withdraw', label: 'Deposit/Withdraw', excel: 'Deposit/Withdraw' },
  { key: 'ordersTransactions', column: 'orders_transactions', label: 'Orders and Transactions', excel: 'Orders and Transactions' },
  { key: 'appMt5', column: 'app_mt5', label: 'APP & ActsTrade & MT5', excel: 'APP&ActsTrade&MT5' },
  { key: 'rewardProgram', column: 'reward_program', label: 'Reward Program', excel: 'Reward Program' },
  { key: 'complaint', column: 'complaint', label: 'Complaint', excel: 'Complaint' },
] as const;

export const OTHER_COUNT_FIELDS = [
  { key: 'unsolvedIssues', column: 'unsolved_issues', label: 'Unsolved Issues', excel: 'Unsolved Issues and Customer UID' },
  { key: 'unsolvedCompleted', column: 'unsolved_completed', label: 'Unsolved Completed', excel: 'Unsolved Completed' },
  { key: 'notFollowedUp', column: 'not_followed_up', label: 'Conversations not followed up', excel: 'Conversations not followed up within' },
] as const;

/** Every numeric Weekly Work List field, in workbook column order (C..P). */
export const COUNT_FIELDS = [...CHANNEL_FIELDS, ...CATEGORY_FIELDS, ...OTHER_COUNT_FIELDS] as const;

export type ChannelKey = typeof CHANNEL_FIELDS[number]['key'];
export type CategoryKey = typeof CATEGORY_FIELDS[number]['key'];
export type CountKey = typeof COUNT_FIELDS[number]['key'];

export const STATUSES = ['present', 'sick', 'annual_leave'] as const;
export type CsStatus = typeof STATUSES[number];
export const STATUS_LABELS: Record<CsStatus, string> = { present: 'Present', sick: 'Sick', annual_leave: 'Annual Leave' };

export const DEFAULT_FOLLOW_UP_MINUTES = 4;

export const COMPLAINT_STATUS_OPTIONS = ['Solved', 'On Progress', 'On Hold'] as const;
export const PLATFORM_OPTIONS = ['MT5', 'Apps'] as const;
