# Event model

Slices in the Adam Dymitruk / Martin Dilger style. Each row is one vertical slice:
the trigger, the command, the events it appends, the read model that changes, and any
automation (a todo-list query drained by the background processor).

## Organization

| Trigger | Command | Events | Read model | Automation |
|---|---|---|---|---|
| Platform operator creates org | `create-organization` | `OrganizationCreated`, `UserInvited`, `NotificationQueued` | `org_settings`, `users` | dispatcher sends the invitation |
| Admin changes languages / zone / thresholds | `update-organization-settings` | `OrganizationSettingsUpdated` | `org_settings` | |
| Admin sets colours | `update-branding` | `BrandingUpdated` (rejected with `contrast_insufficient`) | `org_settings` | |
| Admin invites, assigns, revokes, deactivates | `invite-user`, `assign-role`, `revoke-role`, `deactivate-user` | `UserInvited`, `UserRoleAssigned`, `UserRoleRevoked`, `UserDeactivated` | `users`, sessions revoked | |
| Operator toggles a flag | `set-feature-flag` | `FeatureFlagChanged` | `org_settings.feature_flags` | |
| Admin saves a template | `save-template`, `activate-template` | `NotificationTemplateSaved`, `NotificationTemplateActivated` | `notification_templates` | |

## Hiring process

| Trigger | Command | Events | Read model | Automation |
|---|---|---|---|---|
| Manager/HR creates a draft | `create-process` | `HiringProcessCreated` (reference `RB-2027-0001`) | `process_summary` | |
| Editing criteria and plan | `add-criterion`, `update-criterion`, `remove-criterion`, `reorder-criteria`, `assign-assessment-method`, `define-rubric`, `add-knockout` | `MeritCriterionAdded/Updated/Removed`, `AssessmentMethodAssigned/Removed`, `RubricDefined`, `KnockoutQuestionAdded` | `process_summary` | |
| Stages, board, conflicts | `set-stages`, `set-board`, `declare-conflict` | `StageAdded/Renamed/Removed`, `BoardMemberAssigned/Removed`, `ConflictOfInterestDeclared` | `process_summary` | |
| Poster text | `draft-poster` | `PosterDrafted` | `process_summary`, `poster_public` (once posted) | |
| Approval | `request-approval`, `approve-process`, `reject-process`, `return-to-draft` | `ApprovalRequested`, `ProcessApproved`, `ProcessApprovalRejected`, `ProcessReturnedToDraft` | `process_summary` | reactor queues `approval_requested` / `approval_decided` to staff |
| Publish now / later | `publish-posting`, `schedule-posting` | `PostingPublished` (+ `ScreeningOpened` when rolling) / `PostingScheduled` | `poster_public` | **scheduler**: `PostingScheduled` due → `PostingPublished` (actor `system`) |
| Closing time passes | *(scheduler)* | `PostingClosed{reason: scheduled}`, `ScreeningOpened` | `poster_public`, `process_summary` | `run-schedulers` each cycle |
| Extend / amend / close early / cancel / complete | `extend-closing`, `amend-poster`, `close-early`, `cancel-process`, `complete-process` | `ClosingDateExtended`, `PostingAmended`, `PostingClosed{early}`, `ProcessCancelled`, `ProcessCompleted` + `ProcessRetentionClockStarted` | all | reactor notifies applicants (extension, amendment, cancellation) |
| Release screening results | `release-screening-results` | `ScreeningResultsReleased{counts}` | | reactor queues `screened_out` / `screened_in` in a batch |
| Publish interview availability | `publish-interview-slots` | `InterviewSlotsPublished` (rejects `slot_overlap`) | `interview_slots` | |

## Application

| Trigger | Command | Events | Read model | Automation |
|---|---|---|---|---|
| Candidate enters email | `request-magic-link` | `NotificationQueued{magic_link}` | `magic_links` (system) | dispatcher |
| Link used | `/api/candidate/verify` | `CandidateRegistered` (first time) | `candidates`, session cookie | |
| Apply | `start-application` | `ApplicationStarted`, `ApplicationSourceAttributed` | `application_summary` | |
| Typing | `save-answers` (autosave) | `ApplicationAnswersSaved` (answers encrypted) | | |
| Upload | `upload-document` | `DocumentAttached` | `documents` (PendingScan) | **scanner**: `documents-to-scan` → `record-document-scanned` → `DocumentScanned` / `DocumentQuarantined` |
| Submit | `submit-application` | `ConsentRecorded`, `ApplicationSubmitted{version}` (+ `ApplicationScreenedOut{automatic}` on a failed knockout, actor `system`) or `ApplicationResubmitted` | `application_summary` | reactor queues `application_submitted` |
| Withdraw | `withdraw-application` | `ApplicationWithdrawn` | | reactor queues `application_withdrawn` |
| Screening | `screen-in`, `screen-out`, `bulk-screen-out`, `reverse-screening` | `ApplicationScreenedIn{marks, stage}`, `ApplicationScreenedOut{marks, rationale}`, `ScreeningReversed` | `application_summary` | notifications held until release |
| Pipeline | `move-to-stage`, `tag-application`, `add-note` | `ApplicationMovedToStage{from,to,reason}`, `ApplicationTagged`, `NoteAdded{visibility}` | `application_summary` | reactor queues `stage_update` when the stage notifies |
| Scoring | `record-score`, `submit-scores` | `ScoreRecorded` / `ScoreAmended`, `DisagreementFlagged`, `ScoresSubmitted` | assessment workbook (visibility rule in the query) | |
| Consensus | `record-consensus` | `ConsensusRecorded{originalScores, supersedes}`, `CandidateQualified` / `CandidateNotQualified` | `application_summary.qualified` | |
| Exam | `assign-exam`, `start-exam`, `submit-exam`, `release-exam-late` | `ExamAssigned`, `ExamStarted{deadline}`, `ExamSubmitted{late}`, `ExamReleasedLate` | | reactor queues `exam_assigned` |
| Interviews | `send-interview-invitations`, `book-interview`, `book-interview-for-candidate`, `cancel-interview`, `record-interview-notes` | `InterviewInvitationSent`, `InterviewSlotBooked` (process stream) + `InterviewBooked` / `InterviewRescheduled`, `InterviewCancelled`, `InterviewNotesRecorded` | `interview_slots` | reactor queues confirmation / reschedule / cancellation; **scheduler** queues `interview_reminder` 24 h before |
| Offers | `draft-offer`, `request-offer-approval`, `approve-offer`, `reject-offer`, `send-offer`, `accept-offer`, `decline-offer`, `rescind-offer` | `OfferDrafted` … `OfferSent{expiresAt}`, `OfferAccepted{typedName, clientHash}` + `CandidateHired`, `OfferDeclined`, `OfferRescinded` | `application_summary.offer` | reactor queues `offer_sent` / `offer_accepted` / `offer_rescinded`; **scheduler** appends `OfferExpired` |
| Self-declaration | `record-self-declaration`, `withdraw-self-declaration` | `SelfDeclarationRecorded` / `SelfDeclarationWithdrawn` on `selfdeclaration-{id}` with its own key | `ee_declarations` (aggregates with suppression only) | |
| Accommodation | `request-accommodation`, `arrange-accommodation` | `AccommodationRequested` / `AccommodationArranged` on `accommodation-{id}` with its own key | `accommodations` (HR only) | reactor queues `accommodation_requested` to the HR advisor |

## Candidate and privacy

| Trigger | Command | Events | Read model | Automation |
|---|---|---|---|---|
| Profile / language / marketing | `update-profile`, `change-locale`, `set-marketing-opt-out` | `CandidateProfileUpdated`, `CandidateLocaleChanged`, `MarketingOptOutSet` | `candidates` | |
| Change email | `request-email-change` → link → confirm | `CandidateEmailChangeRequested`, `CandidateEmailChangeConfirmed` | `candidates` | dispatcher |
| Data export | `request-data-export` | `CandidateDataExportRequested`, `CandidateDataExportCompleted` | `my-data-export` query | dispatcher sends the link |
| Deletion | `request-deletion` | `CandidateDeletionRequested` then `CandidateDeletionDeferred{until}` or `CandidateDataShredded{keyIds}` | keys destroyed, rows purged, tombstone | reactor queues `deletion_deferred` |

## Notifications

| Trigger | Command | Events | Read model | Automation |
|---|---|---|---|---|
| Any reactor | *(inline)* | `NotificationQueued{templateKey, lang, fallback?, subject/body/address encrypted}` | `notification_queue` | **dispatcher**: `notifications-to-send` → provider → `record-notification-sent` / `record-notification-failed` (3 attempts, backoff) |
| Provider bounce | `record-notification-bounced` | `NotificationBounced` | `candidates.email_bounced`, `application_summary.email_bounced` | further sends skipped |

## Operations

| Trigger | Command | Effect |
|---|---|---|
| Processor cycle | `run-projections` | catch every projector up under the command lock |
| Operator / processor | `rebuild-projection{name}` | truncate the projection's tables, reset its checkpoint, replay |
| `/api/health` | | database check, per-projection lag, build info |
