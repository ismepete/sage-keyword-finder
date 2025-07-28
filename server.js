require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const OpenAI = require('openai');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const app = express();
const PORT = process.env.PORT || 3000;

const jobs = {};

// --- Middleware & File Serving ---
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- Constants and Helper Functions (All fully expanded and correct) ---
const REVENUE_MODELS = { transactional: { ctr: 0.08, conversion: 0.02, customerValue: 30000 }, commercial: { ctr: 0.05, conversion: 0.005, customerValue: 30000 }, informational: { ctr: 0.03, conversion: 0.001, customerValue: 30000 }, comparison: { ctr: 0.06, conversion: 0.008, customerValue: 30000 }, navigational: { ctr: 0.01, conversion: 0.001, customerValue: 30000 } };
const AI_SIMULATION = { irrelevantPatterns: ['login', 'credit card', 'coupon', 'promo', 'shipping', 'receipt', 'check', 'lowes', 'target', 'walmart', 'amazon', 'ebay', 'gusto login', 'turbo tax', 'app store', 'enterprise', 'llc', 'the accountant', 'schema browser'], locationPatterns: ['near me', 'near', 'nearby', 'local', 'in my area', 'around me', 'close to me', 'directions', 'address', 'location', 'store hours', 'hours open', 'phone number'], competitorFinancialTerms: ['venmo', 'paypal', 'zelle', 'cashapp', 'square card', 'stripe', 'merchant services'], genericTechTerms: ['downloads folder', 'google timer', 'geo tracker', 'app store', 'mobile app'], personalFinanceTerms: ['roth 401k', 'personal loan', 'credit score', 'mortgage calculator', 'personal budget'], transactionalPatterns: ['buy', 'purchase', 'pricing', 'price', 'cost', 'trial', 'demo', 'free trial', 'sign up', 'get started', 'download now', 'install', 'subscription', 'plan', 'quote', 'estimate', 'consultation'], commercialIntentPatterns: ['software', 'solution', 'platform', 'system', 'service', 'app', 'best', 'top', 'compare', 'vs', 'versus', 'review', 'alternative', 'features', 'benefits', 'pros and cons'], informationalPatterns: ['calculator', 'template', 'meaning', 'definition', 'what is', 'how to', 'guide', 'tutorial', 'examples', 'tips', 'advice', 'help', 'free', 'example', 'sample', 'format'], businessRelevantPatterns: ['accounting', 'payroll', 'bookkeeping', 'financial', 'invoice', 'billing', 'expense', 'tax', 'audit', 'reporting', 'budget', 'cash flow', 'erp', 'finance', 'business', 'small business', 'enterprise'], contentClusters: { 'accounting_software': ['accounting', 'bookkeeping', 'financial management'], 'payroll_management': ['payroll', 'salary', 'wage', 'pay', 'timecard', 'time card', 'time clock'], 'financial_reporting': ['financial', 'reporting', 'reports', 'statement', 'balance sheet', 'income statement', 'cash flow'], 'invoicing_billing': ['invoice', 'billing', 'receipt', 'payment'], 'tax_compliance': ['tax', 'taxes', 'irs', 'deduction', 'form', '941', 'schedule'], 'business_planning': ['business plan', 'budget', 'forecast', 'kpi', 'analysis'], 'small_business_tools': ['small business', 'entrepreneur', 'startup', 'llc', 'sole proprietorship'], 'templates_calculators': ['calculator', 'template', 'generator', 'tool'] } };

async function testOpenAI() { try { await openai.chat.completions.create({ model: "gpt-4o-mini", messages: [{ role: "user", content: "Test" }], max_tokens: 2 }); console.log("✅ OpenAI connection test successful."); return true; } catch (error) { console.error("❌ OpenAI connection test failed:", error); return false; } }

async function evaluateKeywordWithAI(keyword) {
    const prompt = `You are an expert SEO strategist for Sage, an accounting software company.
Analyze the user keyword search query below.

Keyword: "${keyword}"

Your task is to respond ONLY with a valid JSON object with the following schema:
{
  "category": "Company/Brand Name" | "Software Type" | "Accounting Concept" | "Problem/Task" | "Other",
  "is_branded": boolean,
  "brand_name": string | null,
  "intent": "Navigational" | "Informational" | "Comparison" | "Transactional",
  "commercial_value": number, // From 0-100, how likely is the searcher to purchase B2B accounting software soon?
  "reasoning": "A brief explanation of your analysis."
}

---
**Examples:**

Keyword: "how to calculate payroll for small business"
{
  "category": "Problem/Task",
  "is_branded": false,
  "brand_name": null,
  "intent": "Informational",
  "commercial_value": 85,
  "reasoning": "High-value informational query. The user has a core accounting problem, making them an ideal potential customer."
}

Keyword: "quickbooks login"
{
  "category": "Company/Brand Name",
  "is_branded": true,
  "brand_name": "QuickBooks",
  "intent": "Navigational",
  "commercial_value": 5,
  "reasoning": "Navigational query for an existing competitor user. Very low acquisition value."
}
---

**Analysis for "${keyword}":**
`;
    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [{ role: "system", content: "You are an SEO expert that only responds in valid JSON." },{ role: "user", content: prompt }],
            max_tokens: 400,
            temperature: 0.0,
            response_format: { type: "json_object" }
        });
        return JSON.parse(response.choices[0].message.content);
    } catch (error) {
        console.error(`❌ AI evaluation error for "${keyword}":`, error.message);
        return null;
    }
}

async function generateStrategicContext(keyword, aiAnalysis) { const prompt = `For the keyword "${keyword}", which our AI analyzed as having intent "${aiAnalysis.intent}" and commercial value ${aiAnalysis.commercial_value}/100, write a 1-2 sentence strategic angle for Sage, an accounting software company.`; try { const response = await openai.chat.completions.create({ model: "gpt-4o-mini", messages: [{ role: "user", content: prompt }], max_tokens: 100, temperature: 0.5 }); return response.choices[0].message.content.trim(); } catch (error) { console.error('AI context error:', error); return 'Strategic analysis unavailable'; } }
function analyzeKeywordRelevance(keyword) { const k = keyword.toLowerCase(); if (AI_SIMULATION.irrelevantPatterns.some(p => k.includes(p))) return 0; if (AI_SIMULATION.locationPatterns.some(p => k.includes(p))) return 0; if (AI_SIMULATION.competitorFinancialTerms.some(p => k.includes(p))) return 0; if (AI_SIMULATION.genericTechTerms.some(p => k.includes(p))) return 0; if (AI_SIMULATION.personalFinanceTerms.some(p => k.includes(p))) return 0; if (AI_SIMULATION.businessRelevantPatterns.some(p => k.includes(p))) return 90; return 50; }
function analyzeCommercialIntent(keyword) { const k = keyword.toLowerCase(); if (AI_SIMULATION.informationalPatterns.some(p => k.includes(p))) return 'informational'; if (AI_SIMULATION.transactionalPatterns.some(p => k.includes(p))) return 'transactional'; if (AI_SIMULATION.commercialIntentPatterns.some(p => k.includes(p))) return 'commercial'; return AI_SIMULATION.businessRelevantPatterns.some(p => k.includes(p)) ? 'informational' : 'commercial';}
function identifyContentCluster(keyword) { const k = keyword.toLowerCase(); for (const [cluster, patterns] of Object.entries(AI_SIMULATION.contentClusters)) { if (patterns.some(p => k.includes(p))) return cluster; } return 'general_business'; }
function calculateIntentBasedRevenue(keyword, intent) { const model = REVENUE_MODELS[intent?.toLowerCase()] || REVENUE_MODELS.commercial; return { estimatedTraffic: Math.floor((keyword.volume || 0) * model.ctr), monthlyRevenue: Math.floor((keyword.volume || 0) * model.ctr * model.conversion * model.customerValue / 12), revenueModel: { intent, ...model } }; }
function calculatePaidInsights(keyword, cpc, difficulty, intent) { let basePaidCTR = 0.04, iMultiplier = 1.0, cMultiplier = 1.0; if (intent === 'transactional') iMultiplier = 1.25; else if (intent === 'informational') iMultiplier = 0.5; if (cpc > 3) cMultiplier = 0.8; else if (cpc > 1.5) cMultiplier = 0.9; else cMultiplier = 1.1; const paidCTR = basePaidCTR * iMultiplier * cMultiplier; const estimatedPaidClicks = Math.floor((keyword.volume || 0) * paidCTR); const monthlyPaidCost = Math.floor(estimatedPaidClicks * cpc); let paidStrategy = 'organic'; if (cpc > 3 && difficulty > 50) paidStrategy = 'paid_first'; else if (intent === 'transactional' && cpc > 2) paidStrategy = 'both'; else if (cpc > 1.5 && difficulty > 40) paidStrategy = 'both'; else if (difficulty < 30) paidStrategy = 'organic'; return { estimatedPaidClicks, monthlyPaidCost, annualPaidCost: monthlyPaidCost * 12, paidStrategy, paidCTR, isHighValueKeyword: cpc > 10 }; }
function calculateAIEnhancedScore(keyword, sagePosition, relevanceScore, intent) { const { volume = 0, keyword_difficulty: difficulty = 50, best_position: competitorPos = 1 } = keyword; let score = 0, volumeScore = 0; if (volume >= 10000) volumeScore = 40; else if (volume >= 5000) volumeScore = 35; else if (volume >= 2000) volumeScore = 25; else if (volume >= 1000) volumeScore = 15; else if (volume >= 500) volumeScore = 10; else volumeScore = 5; score += volumeScore * (relevanceScore / 100); if (intent === 'transactional') score += 25; else if (intent === 'commercial') score += 15; if (difficulty <= 30) score += 20; else if (difficulty <= 40) score += 15; else if (difficulty <= 50) score += 12; else if (difficulty <= 60) score += 8; else if (difficulty <= 70) score += 5; else score += 2; if (competitorPos === 1) score += 15; else if (competitorPos <= 3) score += 12; else if (competitorPos <= 5) score += 8; if (!sagePosition) score += 10; else if (sagePosition > 10) score += 5; return Math.round(Math.min(Math.max(score, 0), 100)); }

function calculateStrategicScore(keyword, sagePosition, aiAnalysis) {
    const { commercial_value = 0, intent, category, is_branded } = aiAnalysis;
    const { volume = 0, keyword_difficulty: difficulty = 50 } = keyword;
    let score = commercial_value;
    if (sagePosition && sagePosition <= 3) { score *= 0.1; } 
    else if (sagePosition && sagePosition <= 10) { score *= 0.6;} 
    else if (!sagePosition) { score += 10; }
    if (is_branded && intent !== 'Comparison') { score *= 0.2; }
    if (category === 'Problem/Task') score += 15;
    if (difficulty <= 10) score += 20;
    else if (difficulty <= 30) score += 10;
    if (volume >= 10000) score += 5;
    return Math.round(Math.min(score, 100));
}

async function performFullAnalysis(jobId, options) {
    const { competitor, minVolume, country, keywordLimit, resultsLimit, enableAI } = options;
    const apiKey = process.env.AHREFS_API_KEY;
    const useAI = enableAI === 'true';
    try {
        jobs[jobId].status = 'processing'; jobs[jobId].progress = 'Initializing...';
        if (useAI && !(await testOpenAI())) throw new Error('AI service unavailable.');
        jobs[jobId].progress = `Fetching keywords from Ahrefs...`;
        const keywordsUrl = 'https://api.ahrefs.com/v3/site-explorer/organic-keywords';
        const requestDate = new Date().toISOString().split('T')[0];
        const response = await axios.get(keywordsUrl, { headers: { 'Authorization': `Bearer ${apiKey}` }, params: { target: competitor, date: requestDate, select: 'keyword,best_position,volume,keyword_difficulty,cpc', country, limit: parseInt(keywordLimit), order_by: 'volume:desc' }});
        const keywordData = response.data.keywords || [];
        if (keywordData.length === 0) { jobs[jobId].status = 'complete'; jobs[jobId].data = { totalKeywords: 0, opportunities: [], aiAnalysis: { aiMode: useAI } }; return; }
        const brandTerms = { 'quickbooks.intuit.com': ['quickbooks', 'intuit'], 'xero.com': ['xero'], 'netsuite.com': ['netsuite'] };
        const excludeTerms = brandTerms[competitor] || [];
        let analyzedKeywords = [];
        for (const [i, keyword] of keywordData.entries()) {
            jobs[jobId].progress = `Analyzing keyword ${i + 1} of ${keywordData.length}...`;
            if (!keyword.volume || keyword.volume < parseInt(minVolume)) continue;
            if (keyword.keyword.trim().split(/\s+/).length === 1) continue;
            if (excludeTerms.some(term => keyword.keyword.toLowerCase().includes(term))) continue;
            let analysis;
            if (useAI) {
                const aiResult = await evaluateKeywordWithAI(keyword.keyword);
                if (!aiResult) continue;
                analysis = { ...aiResult, aiPowered: true };
            } else {
                const relevanceScore = analyzeKeywordRelevance(keyword.keyword);
                if (relevanceScore < 30) continue;
                analysis = { relevanceScore, commercialIntent: analyzeCommercialIntent(keyword.keyword), aiPowered: false };
            }
            analysis.contentCluster = identifyContentCluster(keyword.keyword);
            analyzedKeywords.push({ ...keyword, aiAnalysis: analysis });
        }
        analyzedKeywords.sort((a, b) => { 
            const scoreA = useAI ? calculateStrategicScore(a, null, a.aiAnalysis) : calculateAIEnhancedScore(a, null, a.aiAnalysis.relevanceScore, a.aiAnalysis.commercialIntent); 
            const scoreB = useAI ? calculateStrategicScore(b, null, b.aiAnalysis) : calculateAIEnhancedScore(b, null, b.aiAnalysis.relevanceScore, b.aiAnalysis.commercialIntent); 
            return scoreB - scoreA; 
        });
        let opportunities = [];
        for (const [i, keyword] of analyzedKeywords.slice(0, parseInt(resultsLimit)).entries()) {
            // This is the conditional progress message fix
            const progressMessage = useAI ? `Enriching with AI: Opportunity ${i + 1} of ${resultsLimit}...` : `Checking Sage rank: Opportunity ${i + 1} of ${resultsLimit}...`;
            jobs[jobId].progress = progressMessage;
            let sagePosition = null;
            try {
                const serpUrl = 'https://api.ahrefs.com/v3/serp-overview/serp-overview';
                const sageResponse = await axios.get(serpUrl, { headers: { 'Authorization': `Bearer ${apiKey}` }, params: { keyword: keyword.keyword, country, select: 'position,url' } });
                const sageResult = sageResponse.data.positions?.find(r => r.url?.includes('sage.com'));
                if (sageResult) sagePosition = sageResult.position;
            } catch (error) { console.warn(`⚠️ SERP check error`); }
            
            const score = useAI ? calculateStrategicScore(keyword, sagePosition, keyword.aiAnalysis) : calculateAIEnhancedScore(keyword, sagePosition, keyword.aiAnalysis.relevanceScore, keyword.aiAnalysis.commercialIntent);
            if (score >= 15) {
                if (useAI) { keyword.aiAnalysis.strategicContext = await generateStrategicContext(keyword.keyword, keyword.aiAnalysis); }
                const intentForRevenue = useAI ? keyword.aiAnalysis.intent : keyword.aiAnalysis.commercialIntent;
                const revenueData = calculateIntentBasedRevenue(keyword, intentForRevenue);
                const paidInsights = calculatePaidInsights(keyword, keyword.cpc ? keyword.cpc / 100 : 5.0, keyword.keyword_difficulty, intentForRevenue);
                opportunities.push({ keyword: keyword.keyword, searchVolume: keyword.volume, difficulty: keyword.keyword_difficulty, competitorPosition: keyword.best_position, sagePosition, score, cpc: keyword.cpc ? keyword.cpc / 100 : 5.0, estimatedTraffic: revenueData.estimatedTraffic, monthlyRevenue: revenueData.monthlyRevenue, aiInsights: { ...keyword.aiAnalysis, revenueModel: revenueData.revenueModel, paidInsights }});
            }
            await new Promise(resolve => setTimeout(resolve, 600));
        }
        console.log(`✅ BACKGROUND JOB ${jobId}: Complete! Found ${opportunities.length} opportunities.`);
        jobs[jobId].status = 'complete';
        jobs[jobId].data = { totalKeywords: keywordData.length, opportunities: opportunities.sort((a, b) => b.score - a.score), aiAnalysis: { totalAnalyzed: keywordData.length, aiMode: useAI } };
    } catch (error) {
        console.error(`❌ BACKGROUND JOB ${jobId} FAILED:`, error);
        jobs[jobId].status = 'error';
        jobs[jobId].error = error.message;
    }
}

// --- API Routes ---
app.post('/api/analyze', (req, res) => { const jobId = uuidv4(); jobs[jobId] = { id: jobId, status: 'pending', progress: 'Job received...' }; performFullAnalysis(jobId, req.body).catch(err => { console.error(`Unhandled fatal error in job ${jobId}:`, err); jobs[jobId].status = 'error'; jobs[jobId].error = 'A critical server error occurred.'; }); res.status(202).json({ jobId }); });
app.get('/api/status/:jobId', (req, res) => { const job = jobs[req.params.jobId]; if (!job) return res.status(404).json({ error: 'Job not found' }); res.json(job); });
app.listen(PORT, () => { console.log(`🚀 Server running at http://localhost:${PORT}`); });