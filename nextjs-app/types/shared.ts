export type Locale = 'en' | 'fr';
export const LOCALES: Locale[] = ['en', 'fr'];

// Content fields are {lang: text} maps (spec §9.8)
export type LangMap = Partial<Record<Locale, string>>;

export interface LanguageSetting { code: Locale; required: boolean; }

export type CriterionType = 'essential' | 'asset' | 'organizational_need' | 'operational_requirement' | 'condition_of_employment';
export const CRITERION_PREFIX: Record<CriterionType, string> = {
  essential: 'E', asset: 'A', organizational_need: 'O', operational_requirement: 'R', condition_of_employment: 'C'
};

export type AssessmentMethod = 'application' | 'written_exam' | 'interview' | 'reference_check' | 'portfolio' | 'sle' | 'other';
export const SCORED_METHODS: AssessmentMethod[] = ['written_exam', 'interview', 'reference_check', 'portfolio', 'sle', 'other'];

export interface Criterion { code: string; type: CriterionType; text: LangMap; order: number; }
export interface PlanEntry { criterionCode: string; method: AssessmentMethod; rubricId?: string; }
export interface Rubric { rubricId: string; name: string; scale: { min: number; max: number }; passMark: number; descriptors: LangMap; }
export interface Stage {
  stageId: string; name: LangMap; candidateLabel: LangMap; notifies: boolean; requiresConsensus: boolean; order: number;
  ageingThresholdDays?: number;
}
export interface BoardMember { userId: string; role: 'chair' | 'assessor'; }
export interface Knockout { code: string; question: LangMap; expected: 'yes' | 'no'; }
export interface InterviewSlot { slotId: string; startsAt: string; endsAt: string; boardUserIds: string[]; status: 'open' | 'booked' | 'cancelled'; applicationId?: string; }

export type ProcessStatus = 'Draft' | 'PendingApproval' | 'Approved' | 'Scheduled' | 'Posted' | 'Closed' | 'Completed' | 'Cancelled';
export type ApplicationStatus = 'Draft' | 'Submitted' | 'Active' | 'ScreenedOut' | 'NotQualified' | 'Hired' | 'Withdrawn';
export type OfferStatus = 'Draft' | 'PendingApproval' | 'Approved' | 'Sent' | 'Accepted' | 'Declined' | 'Expired' | 'Rescinded';
export type ScanStatus = 'PendingScan' | 'Available' | 'Quarantined';

export type StaffRole = 'org_admin' | 'hr_advisor' | 'hiring_manager' | 'assessor' | 'auditor';
export const STAFF_ROLES: StaffRole[] = ['org_admin', 'hr_advisor', 'hiring_manager', 'assessor', 'auditor'];

export const DEFAULT_STAGES: Stage[] = [
  { stageId: 'applied', name: { en: 'Applied', fr: 'Candidature reçue' }, candidateLabel: { en: 'Application received', fr: 'Candidature reçue' }, notifies: false, requiresConsensus: false, order: 1 },
  { stageId: 'screening', name: { en: 'Screening', fr: 'Présélection' }, candidateLabel: { en: 'Under review', fr: 'En cours d’examen' }, notifies: false, requiresConsensus: false, order: 2 },
  { stageId: 'assessment', name: { en: 'Assessment', fr: 'Évaluation' }, candidateLabel: { en: 'Being assessed', fr: 'En cours d’évaluation' }, notifies: false, requiresConsensus: true, order: 3 },
  { stageId: 'interview', name: { en: 'Interview', fr: 'Entrevue' }, candidateLabel: { en: 'Interview stage', fr: 'Étape de l’entrevue' }, notifies: true, requiresConsensus: false, order: 4, ageingThresholdDays: 10 },
  { stageId: 'reference_check', name: { en: 'Reference Check', fr: 'Vérification des références' }, candidateLabel: { en: 'Reference check', fr: 'Vérification des références' }, notifies: false, requiresConsensus: false, order: 5 },
  { stageId: 'qualified', name: { en: 'Qualified', fr: 'Qualifié' }, candidateLabel: { en: 'Qualified', fr: 'Qualifié·e' }, notifies: true, requiresConsensus: false, order: 6 },
  { stageId: 'offer', name: { en: 'Offer', fr: 'Offre' }, candidateLabel: { en: 'Offer stage', fr: 'Étape de l’offre' }, notifies: false, requiresConsensus: false, order: 7 },
  { stageId: 'hired', name: { en: 'Hired', fr: 'Embauché' }, candidateLabel: { en: 'Hired', fr: 'Embauché·e' }, notifies: false, requiresConsensus: false, order: 8 }
];

export const PLACEHOLDER_VOCABULARY = [
  'candidate_name', 'process_title', 'reference', 'closing_time', 'organization_name', 'stage_label',
  'interview_time', 'offer_expiry', 'link', 'reason', 'window_start', 'window_end', 'position', 'start_date', 'salary'
];
