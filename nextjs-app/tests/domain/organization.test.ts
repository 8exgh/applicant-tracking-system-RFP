import { describe, it, expect } from 'vitest';
import { given, types, expectError } from './helpers';
import {
  replayOrganization, decideCreateOrganization, decideUpdateBranding, decideInviteUser, decideUpdateStageTemplate, decideSetFeatureFlag
} from '@/lib/domain/organization';
import { DEFAULT_STAGES } from '@/types/shared';

const TENANT = '11111111-1111-4111-8111-111111111111';
const created = { type: 'OrganizationCreated', payload: { tenantId: TENANT, name: 'Riverbend Municipality', slug: 'riverbend', timeZone: 'America/Edmonton', languages: [{ code: 'en', required: true }, { code: 'fr', required: true }] } };

describe('F01 Organizations', () => {
  it('Platform operator creates an organization', () => {
    const events = decideCreateOrganization(replayOrganization([]), { tenantId: TENANT, name: 'Prairie Health Co-op', slug: 'prairie', timeZone: 'America/Regina' });
    expect(types(events)).toEqual(['OrganizationCreated']);
    expect(events[0].payload).toMatchObject({ slug: 'prairie', timeZone: 'America/Regina' });
  });

  it('Slug must be URL-safe', () => {
    expectError(() => decideCreateOrganization(replayOrganization([]), { tenantId: TENANT, name: 'River Bend', slug: 'River Bend!', timeZone: 'America/Regina' }), 'slug_invalid');
  });

  it('Branding must meet contrast requirements', () => {
    const state = replayOrganization(given([created]));
    const err = expectError(() => decideUpdateBranding(state, { primary: '#FFFF00', surface: '#FFFFFF' }), 'contrast_insufficient');
    expect((err.details as { ratio: string }).ratio).toBe('1.07:1');
    expect(types(decideUpdateBranding(state, { primary: '#1A4480' }))).toEqual(['BrandingUpdated']);
  });

  it('Feature flags are per organization', () => {
    const state = replayOrganization(given([created]));
    expect(types(decideSetFeatureFlag(state, { flag: 'rolling_screening', enabled: true }))).toEqual(['FeatureFlagChanged']);
  });

  it('Invited users need unique emails', () => {
    const state = replayOrganization(given([created, { type: 'UserInvited', payload: { userId: 'u1', email: 'sam@riverbend.example', roles: ['org_admin'] } }]));
    expectError(() => decideInviteUser(state, { userId: 'u2', email: 'SAM@riverbend.example', displayName: 'Sam', roles: ['hr_advisor'], language: 'en' }), 'email_taken');
  });

  it('F21 Candidate-facing stage labels are required in all required languages', () => {
    const state = replayOrganization(given([created]));
    const stages = DEFAULT_STAGES.map(s => s.stageId === 'assessment' ? { ...s, candidateLabel: { en: 'Being assessed' } } : s);
    const err = expectError(() => decideUpdateStageTemplate(state, { stages }), 'missing_language_content');
    expect(JSON.stringify(err.details)).toContain('fr');
  });
});
