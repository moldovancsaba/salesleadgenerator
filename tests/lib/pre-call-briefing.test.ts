import { describe, it, expect } from 'vitest';
import { generatePreCallBriefing } from '@/lib/pre-call-briefing';
import type { Lead } from '@/app/types';

describe('generatePreCallBriefing', () => {
  it('generates a complete pre-call briefing for a lead with tech signals and decision maker', () => {
    const lead: Lead = {
      _id: 'lead-123',
      entity_name: 'Olympique Lyonnais',
      country: 'France',
      region: 'Auvergne-Rhône-Alpes',
      cityName: 'Lyon',
      industry: 'Football Club',
      kanbanColumn: 'ENGAGED',
      sortOrder: 1,
      qualityStatus: 'VERIFIED',
      feedbackScore: 0,
      declineCount: 0,
      acceptanceCount: 0,
      deals: [{ id: 'd-1', value: 35000, currency: 'EUR', createdAt: '', updatedAt: '', source: 'manual' }],
      ice: { impact: 8, confidence: 7, ease: 6 },
      techSignals: ['shopify', 'gtm', 'react'],
      contacts: [
        {
          name: 'Jean-Luc Dubois',
          role: 'Commercial Director',
          email: 'jl.dubois@ol.fr',
          linkedin: 'https://linkedin.com/in/jldubois',
          isDecisionMaker: true,
          buyingRole: 'economic_buyer',
        },
        {
          name: 'Claire Moreau',
          role: 'Marketing Lead',
          email: 'c.moreau@ol.fr',
        },
      ],
      notes: 'Met at Paris Sports Summit. High interest in fan selfies for matchday LED screens.',
      qualification: {
        budgetNotes: 'EUR 30k allocated for Q2 commercial tech pilot.',
        needNotes: 'Need trackable sponsor activation for Orange partnership.',
      },
    };

    const briefing = generatePreCallBriefing(lead, '€');

    expect(briefing.prospect.entityName).toBe('Olympique Lyonnais');
    expect(briefing.prospect.stage).toBe('ENGAGED');
    expect(briefing.prospect.location).toBe('Lyon, Auvergne-Rhône-Alpes, France');
    expect(briefing.prospect.estimatedValue).toBe('€35,000');
    expect(briefing.prospect.iceScore).toBe(21);
    expect(briefing.prospect.additionalContactsCount).toBe(1);

    expect(briefing.prospect.decisionMaker).toBeDefined();
    expect(briefing.prospect.decisionMaker?.name).toBe('Jean-Luc Dubois');
    expect(briefing.prospect.decisionMaker?.title).toBe('Commercial Director');
    expect(briefing.prospect.decisionMaker?.email).toBe('jl.dubois@ol.fr');
    expect(briefing.prospect.decisionMaker?.linkedinUrl).toBe('https://linkedin.com/in/jldubois');

    // Tech pitch & questions
    expect(briefing.domainPitch.detectedSignals).toContain('shopify');
    expect(briefing.recommendedQuestions.some((q) => q.category === 'tech_stack')).toBe(true);
    expect(briefing.recommendedQuestions.some((q) => q.category === 'commercial')).toBe(true);

    // Markdown summary
    expect(briefing.markdownCheatSheet).toContain('# Pre-Call Executive Briefing: Olympique Lyonnais');
    expect(briefing.markdownCheatSheet).toContain('Jean-Luc Dubois (Commercial Director)');
    expect(briefing.markdownCheatSheet).toContain('Met at Paris Sports Summit');
    expect(briefing.markdownCheatSheet).toContain('EUR 30k allocated');
  });

  it('handles sparse lead gracefully without crashing', () => {
    const sparseLead: Lead = {
      _id: 'lead-empty',
      entity_name: 'FC Rapid',
      country: 'Romania',
      region: 'Bucharest',
      kanbanColumn: 'DISCOVERED',
      sortOrder: 0,
      qualityStatus: 'DRAFT',
      feedbackScore: 0,
      declineCount: 0,
      acceptanceCount: 0,
    };

    const briefing = generatePreCallBriefing(sparseLead, '$');

    expect(briefing.prospect.entityName).toBe('FC Rapid');
    expect(briefing.prospect.estimatedValue).toBe('Not Set');
    expect(briefing.prospect.decisionMaker).toBeUndefined();
    expect(briefing.prospect.additionalContactsCount).toBe(0);
    expect(briefing.recommendedQuestions.length).toBeGreaterThan(0);
    expect(briefing.keyObjectionsCheatSheet.length).toBeGreaterThan(0);
    expect(briefing.markdownCheatSheet).toContain('FC Rapid');
  });
});
