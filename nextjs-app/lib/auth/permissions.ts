import { StaffRole } from '@/types/shared';

// Role → action matrix (spec §3, F04). Process scoping (hiring manager and
// assessor) is applied on top by the command layer.
export type Action =
  | 'org.settings' | 'org.users' | 'org.templates' | 'org.flags' | 'org.export' | 'org.sessions'
  | 'process.create' | 'process.edit' | 'process.approve' | 'process.publish' | 'process.cancel' | 'process.board' | 'process.view'
  | 'application.screen' | 'application.move' | 'application.tag' | 'application.note' | 'application.view'
  | 'score.record' | 'consensus.record' | 'exam.administer' | 'interview.schedule' | 'interview.notes'
  | 'offer.draft' | 'offer.approve' | 'offer.send'
  | 'timeline.view' | 'staffing_file.export' | 'reports.view' | 'ee.aggregate' | 'accommodation.view' | 'note.hr_only';

const MATRIX: Record<Action, StaffRole[]> = {
  'org.settings': ['org_admin'],
  'org.users': ['org_admin'],
  'org.templates': ['org_admin'],
  'org.flags': [],
  'org.export': ['org_admin'],
  'org.sessions': ['org_admin'],
  'process.create': ['org_admin', 'hr_advisor', 'hiring_manager'],
  'process.edit': ['org_admin', 'hr_advisor', 'hiring_manager'],
  'process.approve': ['org_admin'],
  'process.publish': ['org_admin', 'hr_advisor'],
  'process.cancel': ['org_admin', 'hr_advisor'],
  'process.board': ['org_admin', 'hr_advisor', 'hiring_manager'],
  'process.view': ['org_admin', 'hr_advisor', 'hiring_manager', 'assessor', 'auditor'],
  'application.screen': ['org_admin', 'hr_advisor', 'hiring_manager'],
  'application.move': ['org_admin', 'hr_advisor', 'hiring_manager'],
  'application.tag': ['org_admin', 'hr_advisor', 'hiring_manager'],
  'application.note': ['org_admin', 'hr_advisor', 'hiring_manager', 'assessor'],
  'application.view': ['org_admin', 'hr_advisor', 'hiring_manager', 'assessor', 'auditor'],
  'score.record': ['assessor', 'hiring_manager'],
  'consensus.record': ['hiring_manager', 'hr_advisor', 'org_admin', 'assessor'],
  'exam.administer': ['org_admin', 'hr_advisor'],
  'interview.schedule': ['org_admin', 'hr_advisor', 'hiring_manager'],
  'interview.notes': ['assessor', 'hiring_manager'],
  'offer.draft': ['org_admin', 'hr_advisor', 'hiring_manager'],
  'offer.approve': ['org_admin'],
  'offer.send': ['org_admin', 'hr_advisor'],
  'timeline.view': ['org_admin', 'hr_advisor', 'hiring_manager', 'auditor'],
  'staffing_file.export': ['org_admin', 'hr_advisor', 'auditor'],
  'reports.view': ['org_admin', 'hr_advisor', 'auditor'],
  'ee.aggregate': ['org_admin', 'hr_advisor'],
  'accommodation.view': ['org_admin', 'hr_advisor'],
  'note.hr_only': ['org_admin', 'hr_advisor']
};

export function can(roles: StaffRole[], action: Action): boolean {
  return MATRIX[action].some(r => roles.includes(r));
}

export const AUDITOR_READ_ONLY = true;
