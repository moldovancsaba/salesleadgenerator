import { describe, it, expect } from 'vitest';
import {
  exportLeadsToCsv,
  exportLeadsToGoogleSheetsTsv,
  parseCsvOrTsv,
  detectCrmPreset,
  normalizeCountryToIso,
  normalizeCrmStageToKanban,
  parseCrmImport,
} from '../../lib/crm-lead-exchange';
import type { Lead } from '@/app/types';

describe('Multi-CRM Lead Exchange (issue 254)', () => {
  const sampleLeads: Partial<Lead>[] = [
    {
      _id: 'lead-1',
      entity_name: 'FC Barcelona Innovation Hub',
      url: 'https://barcainnovationhub.com',
      country: 'ES',
      cityName: 'Barcelona',
      region: 'Catalonia, Spain',
      sport_or_sector: 'Football',
      kanbanColumn: 'ENGAGED',
      ice: { impact: 7, confidence: 5, ease: 4 },
      estimated_annual_revenue_usd: 50000,
      contacts: [
        {
          name: 'Albert Mundet',
          title: 'Director of Innovation',
          email: 'albert@barcainnovationhub.com',
          phone: '+34 93 496 36 00',
          buyingRole: 'decision_maker',
        },
      ],
      notes: 'Strong sports tech lead, interested in fan engagement.',
      value_proposition: 'AI fan engagement platform for matchdays',
      tags: ['top-tier', 'spain'],
    },
    {
      _id: 'lead-2',
      entity_name: 'Dallas Mavericks',
      url: 'https://mavs.com',
      country: 'US',
      cityName: 'Dallas',
      region: 'Texas, USA',
      sport_or_sector: 'Basketball',
      kanbanColumn: 'PROPOSAL',
      ice: { impact: 9, confidence: 5, ease: 4 },
      estimated_annual_revenue_usd: 75000,
      contacts: [
        {
          name: 'Cynthia Marshall',
          title: 'CEO',
          email: 'cynt@mavs.com',
          phone: '+1 214 747 6287',
          buyingRole: 'economic_buyer',
        },
      ],
      notes: 'Meeting held, sent custom pricing proposal.',
      tags: ['nba'],
    },
  ];

  describe('Country and Stage Normalization', () => {
    it('normalizes common country names and variations to valid ISO 3166-1 alpha-2', () => {
      expect(normalizeCountryToIso('Spain')).toBe('ES');
      expect(normalizeCountryToIso('España')).toBe('ES');
      expect(normalizeCountryToIso('United States')).toBe('US');
      expect(normalizeCountryToIso('USA')).toBe('US');
      expect(normalizeCountryToIso('Germany')).toBe('DE');
      expect(normalizeCountryToIso('Deutschland')).toBe('DE');
      expect(normalizeCountryToIso('Hungary')).toBe('HU');
      expect(normalizeCountryToIso('United Kingdom')).toBe('GB');
      expect(normalizeCountryToIso('FR')).toBe('FR');
      expect(normalizeCountryToIso('Kosovo')).toBe('XK');
      expect(normalizeCountryToIso('unknown-country-xyz')).toBe('US');
      expect(normalizeCountryToIso('')).toBe('US');
    });

    it('maps CRM statuses into Kanban columns', () => {
      expect(normalizeCrmStageToKanban('lead')).toBe('DISCOVERED');
      expect(normalizeCrmStageToKanban('Lead In')).toBe('DISCOVERED');
      expect(normalizeCrmStageToKanban('Open - Not Contacted')).toBe('DISCOVERED');
      expect(normalizeCrmStageToKanban('marketingqualifiedlead')).toBe('QUALIFIED');
      expect(normalizeCrmStageToKanban('Contact Made')).toBe('QUALIFIED');
      expect(normalizeCrmStageToKanban('Working - Contacted')).toBe('ENGAGED');
      expect(normalizeCrmStageToKanban('Needs Defined')).toBe('ENGAGED');
      expect(normalizeCrmStageToKanban('Proposal Sent')).toBe('PROPOSAL');
      expect(normalizeCrmStageToKanban('opportunity')).toBe('PROPOSAL');
      expect(normalizeCrmStageToKanban('Closed - Converted')).toBe('WON');
      expect(normalizeCrmStageToKanban('Won')).toBe('WON');
      expect(normalizeCrmStageToKanban('Closed - Not Converted')).toBe('LOST');
      expect(normalizeCrmStageToKanban('unqualified')).toBe('LOST');
    });
  });

  describe('CRM Export Formatters', () => {
    it('exports to Google Sheets / Universal CSV with UTF-8 BOM', () => {
      const csv = exportLeadsToCsv(sampleLeads, 'google_sheets');
      expect(csv.charCodeAt(0)).toBe(0xfeff);
      expect(csv).toContain('Company Name');
      expect(csv).toContain('FC Barcelona Innovation Hub');
      expect(csv).toContain('Dallas Mavericks');
      expect(csv).toContain('albert@barcainnovationhub.com');
    });

    it('exports to HubSpot CRM format with HubSpot headers and stages', () => {
      const csv = exportLeadsToCsv(sampleLeads, 'hubspot');
      expect(csv).toContain('Website URL');
      expect(csv).toContain('Lifecycle Stage');
      expect(csv).toContain('HubSpot Owner');
      expect(csv).toContain('salesqualifiedlead'); // ENGAGED
      expect(csv).toContain('opportunity'); // PROPOSAL
      expect(csv).toContain('Albert');
      expect(csv).toContain('Mundet');
    });

    it('exports to Salesforce Sales Cloud format with Salesforce headers', () => {
      const csv = exportLeadsToCsv(sampleLeads, 'salesforce');
      expect(csv).toContain('Company');
      expect(csv).toContain('AnnualRevenue');
      expect(csv).toContain('Rating');
      expect(csv).toContain('Working - Contacted');
      expect(csv).toContain('Hot'); // ICE score 140/180 -> Hot
    });

    it('exports to Pipedrive format with Pipedrive headers', () => {
      const csv = exportLeadsToCsv(sampleLeads, 'pipedrive');
      expect(csv).toContain('Organization Name');
      expect(csv).toContain('Person - Name');
      expect(csv).toContain('Person - Email');
      expect(csv).toContain('Lead Value');
      expect(csv).toContain('Needs Defined');
      expect(csv).toContain('Proposal Sent');
    });

    it('exports to Google Sheets clipboard TSV', () => {
      const tsv = exportLeadsToGoogleSheetsTsv(sampleLeads);
      const lines = tsv.split('\n');
      expect(lines.length).toBe(3);
      expect(lines[0].split('\t')).toContain('Company Name');
      expect(lines[1]).toContain('FC Barcelona Innovation Hub\thttps://barcainnovationhub.com');
    });
  });

  describe('CRM Import Parsers and Auto-Detectors', () => {
    it('parses CSV with quoted strings and embedded commas', () => {
      const raw = `Company Name,Notes,Country\n"Real Madrid, C.F.","Notes with, commas and ""escaped quotes""",Spain\n`;
      const { headers, rows } = parseCsvOrTsv(raw);
      expect(headers).toEqual(['Company Name', 'Notes', 'Country']);
      expect(rows).toHaveLength(1);
      expect(rows[0][0]).toBe('Real Madrid, C.F.');
      expect(rows[0][1]).toBe('Notes with, commas and "escaped quotes"');
      expect(rows[0][2]).toBe('Spain');
    });

    it('auto-detects HubSpot CRM format and imports leads', () => {
      const hubspotCsv = `Company Name,Website URL,First Name,Last Name,Email,Job Title,Lifecycle Stage,Country/Region\nArsenal FC,https://arsenal.com,Mikel,Arteta,mikel@arsenal.com,Manager,salesqualifiedlead,United Kingdom\n`;
      const res = parseCrmImport(hubspotCsv);
      expect(res.preset).toBe('hubspot');
      expect(res.totalRows).toBe(1);
      expect(res.validLeads).toHaveLength(1);

      const lead = res.validLeads[0];
      expect(lead.entity_name).toBe('Arsenal FC');
      expect(lead.url).toBe('https://arsenal.com');
      expect(lead.country).toBe('GB');
      expect(lead.kanbanColumn).toBe('ENGAGED');
      expect(lead.contacts?.[0].name).toBe('Mikel Arteta');
      expect(lead.contacts?.[0].email).toBe('mikel@arsenal.com');
      expect(lead.tags).toContain('source:hubspot');
    });

    it('auto-detects Salesforce CRM format and imports leads', () => {
      const salesforceCsv = `Company,FirstName,LastName,Email,Title,Website,Status,Country\nFC Bayern Munich,Oliver,Kahn,kahn@fcbayern.com,Board,https://fcbayern.com,Closed - Converted,Germany\n`;
      const res = parseCrmImport(salesforceCsv);
      expect(res.preset).toBe('salesforce');
      expect(res.validLeads).toHaveLength(1);

      const lead = res.validLeads[0];
      expect(lead.entity_name).toBe('FC Bayern Munich');
      expect(lead.country).toBe('DE');
      expect(lead.kanbanColumn).toBe('WON');
      expect(lead.contacts?.[0].name).toBe('Oliver Kahn');
      expect(lead.tags).toContain('source:salesforce');
    });

    it('auto-detects Pipedrive format and imports leads', () => {
      const pipedriveCsv = `Organization Name,Person - Name,Person - Email,Stage,Organization Address\nJuventus FC,Giorgio Chiellini,chiellini@juventus.it,Lead In,"Turin, Italy"\n`;
      const res = parseCrmImport(pipedriveCsv);
      expect(res.preset).toBe('pipedrive');
      expect(res.validLeads).toHaveLength(1);

      const lead = res.validLeads[0];
      expect(lead.entity_name).toBe('Juventus FC');
      expect(lead.country).toBe('IT');
      expect(lead.kanbanColumn).toBe('DISCOVERED');
      expect(lead.contacts?.[0].name).toBe('Giorgio Chiellini');
      expect(lead.tags).toContain('source:pipedrive');
    });

    it('handles tab-separated clipboard content directly from Google Sheets', () => {
      const tsv = `Company Name\tWebsite\tCountry\tPrimary Contact Email\nFerencvárosi TC\thttps://fradi.hu\tHungary\tcontact@fradi.hu\n`;
      const res = parseCrmImport(tsv);
      expect(res.validLeads).toHaveLength(1);
      expect(res.validLeads[0].entity_name).toBe('Ferencvárosi TC');
      expect(res.validLeads[0].country).toBe('HU');
      expect(res.validLeads[0].contacts?.[0].email).toBe('contact@fradi.hu');
    });
  });
});
