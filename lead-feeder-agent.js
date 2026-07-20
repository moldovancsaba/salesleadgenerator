#!/usr/bin/env node
/**
 * SLG Lead Feeder Agent
 * 24/7 background service that continuously feeds leads to the webapp
 * Integrates with OpenClaw for persistent operation
 */

const { MongoClient } = require('mongodb');
const { enforceQualityCeiling } = require('./lib/quality-registry.ts');
require('dotenv').config({ path: '.env.local' });

class LeadFeederAgent {
  constructor() {
    this.client = null;
    this.db = null;
    this.isRunning = false;
    this.feedInterval = 60000; // 1 minute
    this.lastFeedTime = null;
    this.stats = {
      totalProcessed: 0,
      totalAccepted: 0,
      totalDeclined: 0,
      errors: 0,
      startTime: new Date()
    };
  }

  async initialize() {
    if (!process.env.MONGODB_URI) {
      throw new Error('MONGODB_URI not found in .env.local');
    }

    this.client = new MongoClient(process.env.MONGODB_URI);
    await this.client.connect();
    this.db = this.client.db('slg');
    console.log('✓ Connected to MongoDB Atlas');
  }

  async generateNewLead() {
    // Simulate lead generation from various sources
    const regions = ['US', 'CEE', 'MENA'];
    const industries = ['Technology', 'Healthcare', 'Finance', 'Education', 'Retail', 'Manufacturing'];
    const companySizes = ['Small', 'Medium', 'Large', 'Enterprise'];
    
    const region = regions[Math.floor(Math.random() * regions.length)];
    const industry = industries[Math.floor(Math.random() * industries.length)];
    const size = companySizes[Math.floor(Math.random() * companySizes.length)];
    
    // Generate ICE scores
    const impact = Math.floor(Math.random() * 10) + 1;
    const confidence = Math.floor(Math.random() * 10) + 1;
    const ease = Math.floor(Math.random() * 10) + 1;
    const iceScore = impact * confidence * ease;
    
    // Determine quality status based on ICE score
    let qualityStatus = 'DRAFT';
    if (iceScore >= 720) qualityStatus = 'VERIFIED';
    else if (iceScore >= 480) qualityStatus = 'CHECKED';
    
    // Apply quality ceiling enforcement
    const upstreamStatuses = ['DRAFT']; // Simulated upstream status
    qualityStatus = enforceQualityCeiling(qualityStatus, upstreamStatuses);
    
    // Determine kanban column based on ICE score
    let kanbanColumn = 'DISCOVERED';
    if (iceScore >= 800) kanbanColumn = 'QUALIFIED';
    else if (iceScore >= 600) kanbanColumn = 'ENGAGED';
    else if (iceScore >= 400) kanbanColumn = 'PROPOSAL';
    
    const lead = {
      id: Date.now() + Math.random(),
      entity_name: `Company ${Math.floor(Math.random() * 10000)}`,
      url: `https://example.com/company-${Math.floor(Math.random() * 10000)}`,
      region: region,
      industry: industry,
      size: size,
      ice: { impact, confidence, ease },
      iceScore: iceScore,
      qualityStatus: qualityStatus,
      kanbanColumn: kanbanColumn,
      sortOrder: Date.now(),
      acceptanceCount: 0,
      declineCount: 0,
      feedbackScore: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      fingerprint: `lead-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    };
    
    return lead;
  }

  async feedLeads() {
    try {
      const leadsCollection = this.db.collection('leads');
      const outcomeLogsCollection = this.db.collection('outcomelogs');
      
      // Generate 1-3 new leads per cycle
      const leadsToGenerate = Math.floor(Math.random() * 3) + 1;
      
      for (let i = 0; i < leadsToGenerate; i++) {
        const lead = await this.generateNewLead();
        
        // Check for duplicates using fingerprint
        const existing = await leadsCollection.findOne({ fingerprint: lead.fingerprint });
        if (existing) {
          continue;
        }
        
        // Insert new lead
        await leadsCollection.insertOne(lead);
        this.stats.totalProcessed++;
        
        // Log outcome
        await outcomeLogsCollection.insertOne({
          leadId: lead._id,
          action: 'GENERATED',
          timestamp: new Date(),
          metadata: {
            region: lead.region,
            industry: lead.industry,
            iceScore: lead.iceScore,
            qualityStatus: lead.qualityStatus
          }
        });
        
        console.log(`✓ Generated lead: ${lead.entity_name} (${lead.region}, ICE: ${lead.iceScore}, ${lead.qualityStatus})`);
      }
      
      this.lastFeedTime = new Date();
      
    } catch (error) {
      console.error('❌ Error feeding leads:', error.message);
      this.stats.errors++;
    }
  }

  async run() {
    this.isRunning = true;
    console.log('🚀 Lead Feeder Agent started');
    console.log(`⏱️  Feed interval: ${this.feedInterval / 1000} seconds`);
    console.log('📊 Monitoring pipeline...\n');
    
    while (this.isRunning) {
      await this.feedLeads();
      
      // Print stats every 5 minutes
      if (this.stats.totalProcessed % 5 === 0 && this.stats.totalProcessed > 0) {
        this.printStats();
      }
      
      await new Promise(resolve => setTimeout(resolve, this.feedInterval));
    }
  }

  printStats() {
    const uptime = (new Date() - this.stats.startTime) / 1000 / 60; // minutes
    console.log('\n=== AGENT STATS ===');
    console.log(`Uptime: ${uptime.toFixed(1)} minutes`);
    console.log(`Total processed: ${this.stats.totalProcessed}`);
    console.log(`Errors: ${this.stats.errors}`);
    console.log(`Last feed: ${this.lastFeedTime?.toLocaleTimeString() || 'Never'}`);
    console.log('==================\n');
  }

  async shutdown() {
    console.log('\n🛑 Shutting down Lead Feeder Agent...');
    this.isRunning = false;
    if (this.client) {
      await this.client.close();
    }
    this.printStats();
    console.log('✓ Agent stopped');
  }
}

// Handle graceful shutdown
const agent = new LeadFeederAgent();

process.on('SIGINT', async () => {
  await agent.shutdown();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await agent.shutdown();
  process.exit(0);
});

// Start the agent
(async () => {
  try {
    await agent.initialize();
    await agent.run();
  } catch (error) {
    console.error('❌ Fatal error:', error.message);
    process.exit(1);
  }
})();
