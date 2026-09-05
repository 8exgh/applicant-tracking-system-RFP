import { Actor } from '@/lib/db/event-store';

// The shape deciders and projectors see. Stored events carry more metadata
// (spec §6); replay only needs what affects state.
export interface ReplayEvent<TPayload = Record<string, unknown>> {
  type: string;
  payload: TPayload;
  occurredAt: Date;
  actor?: Actor;
  role?: string;
  reason?: string;
  causationId?: string;
  globalPosition?: number;
  streamVersion?: number;
}

// A decision: events to append, plus an optional reason for the metadata
export interface DecidedEvent<TPayload = Record<string, unknown>> {
  type: string;
  payload: TPayload;
  reason?: string;
  causationId?: string;
}

export type OrganizationEventType =
  | 'OrganizationCreated' | 'OrganizationSettingsUpdated' | 'BrandingUpdated' | 'FeatureFlagChanged'
  | 'UserInvited' | 'UserActivated' | 'UserRoleAssigned' | 'UserRoleRevoked' | 'UserDeactivated'
  | 'StageTemplateUpdated' | 'SessionsRevoked' | 'BreakGlassOpened' | 'RetentionRuleDefined';

export type HiringProcessEventType =
  | 'HiringProcessCreated' | 'HiringProcessDetailsUpdated'
  | 'MeritCriterionAdded' | 'MeritCriterionUpdated' | 'MeritCriterionRemoved'
  | 'AssessmentMethodAssigned' | 'AssessmentMethodRemoved' | 'RubricDefined'
  | 'StageAdded' | 'StageRenamed' | 'StageRemoved'
  | 'BoardMemberAssigned' | 'BoardMemberRemoved' | 'ConflictOfInterestDeclared' | 'KnockoutQuestionAdded' | 'KnockoutQuestionRemoved'
  | 'ApprovalRequested' | 'ProcessApproved' | 'ProcessApprovalRejected' | 'ProcessReturnedToDraft'
  | 'PosterDrafted' | 'PostingScheduled' | 'PostingPublished' | 'PostingAmended' | 'ClosingDateExtended' | 'PostingClosed'
  | 'ScreeningOpened' | 'ScreeningResultsReleased' | 'ProcessCompleted' | 'ProcessCancelled' | 'ProcessRetentionClockStarted'
  | 'InterviewSlotsPublished' | 'InterviewSlotBooked' | 'InterviewSlotReleased';

export type ApplicationEventType =
  | 'ApplicationStarted' | 'ApplicationSourceAttributed' | 'ApplicationAnswersSaved'
  | 'DocumentAttached' | 'DocumentScanned' | 'DocumentQuarantined' | 'DocumentRemoved'
  | 'ConsentRecorded' | 'ApplicationSubmitted' | 'ApplicationResubmitted' | 'ApplicationWithdrawn'
  | 'ApplicationScreenedIn' | 'ApplicationScreenedOut' | 'ScreeningReversed'
  | 'ApplicationMovedToStage' | 'ApplicationTagged' | 'NoteAdded'
  | 'ScoreRecorded' | 'ScoreAmended' | 'ScoresSubmitted' | 'ConsensusRecorded' | 'DisagreementFlagged'
  | 'ExamAssigned' | 'ExamStarted' | 'ExamSubmitted' | 'ExamReleasedLate'
  | 'InterviewInvitationSent' | 'InterviewBooked' | 'InterviewRescheduled' | 'InterviewCancelled' | 'InterviewNotesRecorded'
  | 'ReferenceRequested' | 'ReferenceProvided' | 'ReferenceRecorded' | 'ReferencesReleasedToBoard'
  | 'CandidateQualified' | 'CandidateNotQualified'
  | 'OfferDrafted' | 'OfferApprovalRequested' | 'OfferApproved' | 'OfferApprovalRejected' | 'OfferSent'
  | 'OfferAccepted' | 'OfferDeclined' | 'OfferExpired' | 'OfferRescinded' | 'CandidateHired';

export type CandidateEventType =
  | 'CandidateRegistered' | 'CandidateProfileUpdated' | 'CandidateLocaleChanged'
  | 'CandidateEmailChangeRequested' | 'CandidateEmailChangeConfirmed' | 'MarketingOptOutSet'
  | 'CandidateDataExportRequested' | 'CandidateDataExportCompleted'
  | 'CandidateDeletionRequested' | 'CandidateDeletionDeferred' | 'CandidateDataShredded';

export type SelfDeclarationEventType = 'SelfDeclarationRecorded' | 'SelfDeclarationWithdrawn';
export type AccommodationEventType = 'AccommodationRequested' | 'AccommodationArranged';
export type NotificationEventType = 'NotificationQueued' | 'NotificationSent' | 'NotificationDeliveryFailed' | 'NotificationBounced';
export type TemplateEventType = 'NotificationTemplateSaved' | 'NotificationTemplateActivated';

export type EventType =
  | OrganizationEventType | HiringProcessEventType | ApplicationEventType | CandidateEventType
  | SelfDeclarationEventType | AccommodationEventType | NotificationEventType | TemplateEventType;

export const streamIds = {
  org: (tenantId: string) => `org-${tenantId}`,
  process: (id: string) => `process-${id}`,
  application: (id: string) => `application-${id}`,
  candidate: (id: string) => `candidate-${id}`,
  selfDeclaration: (applicationId: string) => `selfdeclaration-${applicationId}`,
  accommodation: (applicationId: string) => `accommodation-${applicationId}`,
  notification: (id: string) => `notification-${id}`,
  template: (tenantId: string, key: string) => `template-${tenantId}-${key}`
};

export function streamType(streamId: string): string {
  return streamId.split('-')[0];
}

export function streamEntityId(streamId: string): string {
  const i = streamId.indexOf('-');
  return i === -1 ? streamId : streamId.slice(i + 1);
}
