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
app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });

// --- Constants & Helper Functions ---
// --- Constants & Helper Functions ---
const PRODUCT_FINANCIALS = {
    // UK Products
    "Sage Accounting UK": { acv: 500, currency: '£' },
    "Sage Intacct UK": { acv: 25000, currency: '£' },
    // US Products (and fallbacks)
    "Sage Intacct": { acv: 30000, currency: '$' },
    "Sage Accounting": { acv: 500, currency: '$' } // Fallback, though noted as unused in US
};

const REALISTIC_POTENTIAL_CTR = {
    transactional: 0.14,
    comparison: 0.12,
    commercial: 0.09,
    informational: 0.05,
    navigational: 0.07,
    default: 0.08 // Fallback for any unknown intents
};

const CONVERSION_RATES = {
    smb: { // Sage Accounting
        transactional: 0.025,
        comparison: 0.015,
        commercial: 0.0075,
        informational: 0.001,
        navigational: 0.001,
        default: 0.005
    },
    upperMidMarket: { // Sage Intacct
        transactional: 0.0125,
        comparison: 0.0075,
        commercial: 0.004,
        informational: 0.001,
        navigational: 0.001,
        default: 0.003
    }
};

async function testOpenAI() { try { await openai.chat.completions.create({ model: "gpt-4o-mini", messages: [{ role: "user", content: "Test" }], max_tokens: 2 }); console.log("✅ OpenAI connection test successful."); return true; } catch (error) { console.error("❌ OpenAI connection test failed:", error); return false; } }

async function deconstructTopicWithAI(inputTopic, targetProduct) { const prompt = `You are a B2B market research analyst for Sage. Deconstruct the topic "${inputTopic}" specifically for the software product "${targetProduct}". Identify core sub-topics, 10-15 specific financial and operational pain points this product solves, and key personas. Respond ONLY with a valid JSON object: {"sub_topics": [],"pain_points": [],"personas": []}.`; try { const response = await openai.chat.completions.create({ model: "gpt-4o", messages: [{ role: "system", content: "You are a market research analyst that only responds in valid JSON." }, { role: "user", content: prompt }], temperature: 0.2, response_format: { type: "json_object" } }); return JSON.parse(response.choices[0].message.content); } catch (error) { console.error(`❌ AI Deconstruction error:`, error.message); return null; } }

async function generateSeedKeywordsWithAI(deconstructedTopic, targetProduct) {
    const prompt = `You are an expert B2B SEO strategist for the software product "${targetProduct}". Your task is to generate 8-12 foundational "seed keyword" phrases based on the provided market research. These seeds should be broad enough to capture significant search volume and will be expanded upon later.
**Market Research:**
${JSON.stringify(deconstructedTopic)}
**Your Instructions:**
1.  **Identify Core Themes:** From the "sub_topics", identify the 3-5 most critical commercial themes for a company in this vertical. Focus on topics that imply a need for a software solution.
2.  **Generate Keyword Variations:** For each core theme, create 2-3 seed keyword variations by combining the theme with high-intent commercial modifiers.
3.  **Use High-Intent Modifiers:** Focus on modifiers like "software", "platform", "solutions", "system", and "tools".
4.  **Keep it Concise:** Keywords MUST be 2-4 words long. Avoid overly specific long-tail phrases.
5.  **Crucial Constraint:** The keywords MUST be unbranded. DO NOT use "Sage" or "${targetProduct}".
**Example of GOOD output for this vertical:** ["fleet management software", "route optimization platform", "trucking compliance solutions", "logistics invoicing software"]
**Example of BAD output:** ["software for a fleet manager to control high operational costs"]
Respond ONLY with a valid JSON object: {"seed_keywords": []}`;
    try {
        const response = await openai.chat.completions.create({ model: "gpt-4o", messages: [{ role: "system", content: "You are an SEO strategist that only responds in valid JSON." }, { role: "user", content: prompt }], temperature: 0.6, response_format: { type: "json_object" } });
        const result = JSON.parse(response.choices[0].message.content);
        return result.seed_keywords || [];
    } catch (error) { console.error(`❌ AI Seed Keyword Generation error:`, error.message); return []; }
}

async function evaluateKeywordWithAI(keyword, targetProduct, deconstructionResult) {
    const prompt = `You are an expert SEO strategist for Sage, specifically for their product "${targetProduct}".

Your task is to analyze the keyword: "${keyword}"

**Instructions:**
1.  **Determine the SINGLE PRIMARY user intent.** You MUST choose only one from this list:
    - **Transactional:** The user wants to buy or sign up now (e.g., "buy accounting software", "sage intacct trial").
    - **Commercial:** The user is researching solutions to buy soon (e.g., "best accounting software", "sage vs xero").
    - **Informational:** The user is looking for information or answers, not a product (e.g., "what is double entry bookkeeping").
    - **Navigational:** The user is trying to find a specific website (e.g., "sage login").
2.  **Assess Vertical Relevance:** Score from 0-100 how relevant the keyword is to the core sub-topics and pain points of this vertical: ${JSON.stringify(deconstructionResult)}.
3.  **Assess Commercial Value:** Score from 0-100 how likely the user is to become a high-value customer for Sage.

Respond ONLY with a valid JSON object: {"category": "...", "is_branded": boolean, "brand_name": string | null, "intent": "...", "commercial_value": number, "vertical_relevance": number, "reasoning": "..."}.`;

    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [{ role: "system", content: "You are an SEO expert that only responds in valid JSON and strictly follows instructions." }, { role: "user", content: prompt }],
            max_tokens: 500,
            temperature: 0.0,
            response_format: { type: "json_object" }
        });
        return JSON.parse(response.choices[0].message.content);
    } catch (error) {
        console.error(`❌ AI evaluation error for "${keyword}":`, error.message);
        return null;
    }
}
async function generateStrategicContext(keyword, aiAnalysis) { const prompt = `For the keyword "${keyword}" (Intent: ${aiAnalysis.intent}, Commercial Value: ${aiAnalysis.commercial_value}/100), write a 1-2 sentence strategic angle for Sage, an accounting software company.`; try { const response = await openai.chat.completions.create({ model: "gpt-4o-mini", messages: [{ role: "user", content: prompt }], max_tokens: 100, temperature: 0.5 }); return response.choices[0].message.content.trim(); } catch (error) { console.error('AI context error:', error); return 'Strategic analysis unavailable'; } }

async function expandLateralTopicsWithAI(keyword, reasoning) { const prompt = `You are a world-class content strategist. The user has identified "${keyword}" as a valuable keyword opportunity. The AI's reasoning was: "${reasoning}". Brainstorm a list of 5-7 distinct "lateral" content ideas that would be valuable for the same audience. Focus on: 1. Upstream Problems 2. Downstream Problems 3. Related Job-to-be-Done. Respond ONLY with a valid JSON object with the schema: {"lateral_topics": ["list of strings"]}`; try { const response = await openai.chat.completions.create({ model: "gpt-4o", messages: [{ role: "system", content: "You are a content strategist that only responds in valid JSON." }, { role: "user", content: prompt }], temperature: 0.7, response_format: { type: "json_object" } }); const result = JSON.parse(response.choices[0].message.content); return result.lateral_topics || []; } catch (error) { console.error(`❌ AI Lateral Topic Expansion error:`, error.message); return ["Error generating topics."]; } }

async function extractCoreConcept(keyword) {
    const prompt = `From the following SEO keyword, extract the core 2-3 word searchable noun phrase that represents the main topic.
Keyword: "${keyword}"
Examples:
- "benefits of automated inventory management system" -> "inventory management system"
- "best software for fleet management" -> "fleet management software"
- "how to do digital record keeping" -> "digital record keeping"
Respond with ONLY the core noun phrase.`;
    try {
        const response = await openai.chat.completions.create({ model: "gpt-4o-mini", messages: [{ role: "user", content: prompt }], max_tokens: 20, temperature: 0.0 });
        return response.choices[0].message.content.trim();
    } catch (error) { console.error(`❌ AI Core Concept Extraction error:`, error.message); return keyword; }
}

async function generateGeoPromptsWithAI(coreConcept) {
    const prompt = `You are an expert B2B market researcher. A user is investigating the topic of "${coreConcept}".
Generate a list of 5-7 distinct questions they would ask a large language model (like ChatGPT, Perplexity, or Google's AI Overviews) to research this topic thoroughly.
The questions should be practical and phrased as a real user would type them. Focus on questions that seek to understand the problem, compare solutions, and make a purchase decision.
Respond ONLY with a valid JSON object with the schema: {"geo_prompts": ["list of strings"]}`;
    try {
        const response = await openai.chat.completions.create({ model: "gpt-4o-mini", messages: [{ role: "system", content: "You are a market research assistant that only responds in valid JSON." }, { role: "user", content: prompt }], temperature: 0.7, response_format: { type: "json_object" } });
        const result = JSON.parse(response.choices[0].message.content);
        return result.geo_prompts || [`Could not generate prompts for "${coreConcept}".`];
    } catch (error) { console.error(`❌ AI GEO Prompt Generation error:`, error.message); return ["Error generating GEO prompts."]; }
}

async function getGeoInsightsFromProfound(coreConcept) {
    const apiKey = process.env.PROFOUND_API_KEY;
    if (!apiKey) { return []; }

    const categoryId = "40e7e3ce-a564-4e1d-b675-27bbbe22871c";
    const headers = { 'X-API-Key': apiKey };
    
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - 90);
    const formatDate = (date) => date.toISOString().split('T')[0];

    const requestBody = { category_id: categoryId, start_date: formatDate(startDate), end_date: formatDate(endDate), filters: [{ "field": "prompt_type", "operator": "is", "value": "visibility" }, { "field": "prompt", "operator": "contains", "value": coreConcept }] };
    const apiUrl = 'https://api.tryprofound.com/v1/prompts/answers';

    try {
        const response = await axios.post(apiUrl, requestBody, { headers });
        if (response.data && Array.isArray(response.data.data) && response.data.data.length > 0) {
            const prompts = response.data.data.map(item => item.prompt).filter(Boolean);
            const uniquePrompts = [...new Set(prompts)];
            return uniquePrompts.slice(0, 10);
        }
        return [];
    } catch (error) { return []; }
}

function calculateStrategicScore(keyword, sagePosition, aiAnalysis) {
    // Destructure the new vertical_relevance score, defaulting to 50 if it's missing for any reason.
    const { commercial_value = 0, intent, category, is_branded, vertical_relevance = 50 } = aiAnalysis;
    const { volume = 0, keyword_difficulty: difficulty = 50 } = keyword;

    // --- NEW SCORING LOGIC ---
    // The base score is now a weighted average, with Vertical Relevance being the most important factor.
    let score = (vertical_relevance * 0.7) + (commercial_value * 0.3);

    // Add bonuses for high-value user intent
    if (intent === 'Transactional') score += 15;
    if (intent === 'Comparison') score += 10;
    
    // Add a bonus for low keyword difficulty (quick wins)
    if (difficulty <= 15) score += 20;
    else if (difficulty <= 40) score += 10;

    // A small bonus for very high search volume
    if (volume >= 1000) score += 5;

    // Penalize heavily if we already rank in the top 3
    if (sagePosition && sagePosition <= 3) score *= 0.1;
    
    // Penalize branded keywords that aren't for competitor comparison
    if (is_branded && intent !== 'Comparison') score *= 0.2;
    
    // Ensure the final score is a clean integer between 0 and 100.
    return Math.round(Math.min(score, 100));
}
function calculateIntentBasedRevenue(keyword, intent, targetProduct, country) {
    const lowerIntent = intent?.toLowerCase() || 'commercial';

    // 1. Determine Product Tier and Financials
    const productTier = targetProduct.includes('Intacct') ? 'upperMidMarket' : 'smb';
    const productKey = country === 'gb' ? `${targetProduct} UK` : targetProduct;
    const financials = PRODUCT_FINANCIALS[productKey] || PRODUCT_FINANCIALS[targetProduct];
    const customerValue = financials.acv;

    // 2. Look up CTR and CVR from our new models
    const ctr = REALISTIC_POTENTIAL_CTR[lowerIntent] || REALISTIC_POTENTIAL_CTR.default;
    const cvr = CONVERSION_RATES[productTier][lowerIntent] || CONVERSION_RATES[productTier].default;

    // 3. Perform the calculations
    const estimatedTraffic = Math.floor((keyword.volume || 0) * ctr);
    const monthlyRevenue = Math.floor(estimatedTraffic * cvr * customerValue / 12);
    
    // 4. Return a rich object for display and debugging
    return {
        estimatedTraffic,
        monthlyRevenue,
        currency: financials.currency,
        revenueModel: {
            intent,
            productTier,
            ctr,
            cvr,
            customerValue
        }
    };
}

function calculatePaidInsights(keyword, cpc, difficulty, intent) { let basePaidCTR = 0.04, iMultiplier = 1.0, cMultiplier = 1.0; if (intent === 'transactional') iMultiplier = 1.25; else if (intent === 'informational') iMultiplier = 0.5; if (cpc > 3) cMultiplier = 0.8; else if (cpc > 1.5) cMultiplier = 0.9; else cMultiplier = 1.1; const paidCTR = basePaidCTR * iMultiplier * cMultiplier; const estimatedPaidClicks = Math.floor((keyword.volume || 0) * paidCTR); const monthlyPaidCost = Math.floor(estimatedPaidClicks * cpc); let paidStrategy = 'organic'; if (cpc > 3 && difficulty > 50) paidStrategy = 'paid_first'; else if (intent === 'transactional' && cpc > 2) paidStrategy = 'both'; else if (cpc > 1.5 && difficulty > 40) paidStrategy = 'both'; else if (difficulty < 30) paidStrategy = 'organic'; return { estimatedPaidClicks, monthlyPaidCost, paidStrategy }; }

async function performFullAnalysis(jobId, options) {
    const { topic, minVolume, country, keywordLimit, resultsLimit, targetProduct } = options;
    const apiKey = process.env.AHREFS_API_KEY;
    let deconstructionResult, seedKeywords, finalOpportunities = [], finalKeywordData = [], analyzedKeywordsForDebug = [];
    try {
        jobs[jobId].status = 'processing';
        jobs[jobId].progress = 'Initializing...';
        
        if (!(await testOpenAI())) throw new Error('AI service unavailable.');
        
        jobs[jobId].progress = `🧠 Deconstructing topic: "${topic}"...`;
        deconstructionResult = await deconstructTopicWithAI(topic, targetProduct);
        if (!deconstructionResult) throw new Error('Failed to deconstruct the topic with AI.');

        jobs[jobId].intermediateData = { deconstruction: deconstructionResult };
        
        jobs[jobId].progress = '🌱 Generating seed keywords...';
        seedKeywords = await generateSeedKeywordsWithAI(deconstructionResult, targetProduct);
        if (seedKeywords.length === 0) { throw new Error('AI failed to generate seed keywords.'); }
        
        jobs[jobId].progress = `📡 Fetching keywords from Ahrefs for ${seedKeywords.length} seed(s)...`;
        const keywordsUrl = 'https://api.ahrefs.com/v3/keywords-explorer/matching-terms';
        const response = await axios.get(keywordsUrl, { headers: { 'Authorization': `Bearer ${apiKey}` }, params: { keywords: seedKeywords.join(','), country, limit: parseInt(keywordLimit), order_by: 'volume:desc', select: 'keyword,volume,difficulty,cpc' }});
        let keywordData = response.data.keywords || [];
        finalKeywordData = keywordData;
        if (keywordData.length === 0) { throw new Error('Ahrefs returned no keywords for the generated seed ideas.'); }
        
        keywordData = keywordData.map(kw => ({ ...kw, keyword_difficulty: kw.difficulty }));
        
        let analyzedKeywords = [];
        for (const [i, keyword] of keywordData.entries()) {
            jobs[jobId].progress = `🔬 Strategically analyzing keyword ${i + 1} of ${keywordData.length}...`;
            if (!keyword.volume || keyword.volume < parseInt(minVolume)) continue;
            if (keyword.keyword.trim().split(/\s+/).length === 1) continue;
            
            const analysis = await evaluateKeywordWithAI(keyword.keyword, targetProduct, deconstructionResult);

            if (!analysis) continue;
            
            analysis.aiPowered = true;
            analyzedKeywords.push({ ...keyword, aiAnalysis: analysis });
        }
        
        analyzedKeywords.sort((a, b) => calculateStrategicScore(a, null, a.aiAnalysis) - calculateStrategicScore(b, null, b.aiAnalysis));
        analyzedKeywordsForDebug = analyzedKeywords.slice(0, 20);
        
        for (const [i, keyword] of analyzedKeywords.slice(0, parseInt(resultsLimit)).entries()) {
            jobs[jobId].progress = `✨ Generating strategic angle ${i + 1} of ${resultsLimit}...`;
            let sagePosition = null;
            try {
                const serpUrl = 'https://api.ahrefs.com/v3/serp-overview/serp-overview';
                const sageResponse = await axios.get(serpUrl, { headers: { 'Authorization': `Bearer ${apiKey}` }, params: { keyword: keyword.keyword, country, select: 'position,url' } });
                const sageResult = sageResponse.data.positions?.find(r => r.url?.includes('sage.com'));
                if (sageResult) sagePosition = sageResult.position;
            } catch (error) { console.warn(`⚠️ SERP check error`); }
            
            const score = calculateStrategicScore(keyword, sagePosition, keyword.aiAnalysis);
            if (score >= 25) {
                keyword.aiAnalysis.strategicContext = await generateStrategicContext(keyword.keyword, keyword.aiAnalysis);
                const revenueData = calculateIntentBasedRevenue(keyword, keyword.aiAnalysis.intent, targetProduct, country);
                const paidInsights = calculatePaidInsights(keyword, keyword.cpc ? keyword.cpc / 100 : 5.0, keyword.keyword_difficulty, keyword.aiAnalysis.intent);
                finalOpportunities.push({ 
                    keyword: keyword.keyword, 
                    searchVolume: keyword.volume, 
                    difficulty: keyword.keyword_difficulty, 
                    competitorPosition: keyword.best_position, 
                    sagePosition, 
                    score, 
                    cpc: keyword.cpc ? keyword.cpc / 100 : 5.0, 
                    estimatedTraffic: revenueData.estimatedTraffic, 
                    monthlyRevenue: revenueData.monthlyRevenue,
                    currency: revenueData.currency,
                    aiInsights: { 
                        ...keyword.aiAnalysis, 
                        revenueModel: revenueData, 
                        paidInsights 
                    }
                });
            }
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    } catch (error) {
        console.error(`❌ BACKGROUND JOB ${jobId} FAILED:`, error);
        jobs[jobId].status = 'error';
        jobs[jobId].error = error.message;
    } finally {
        console.log(`✅ BACKGROUND JOB ${jobId}: Finished.`);
        jobs[jobId].status = 'complete';
        jobs[jobId].data = {
            totalKeywords: finalKeywordData.length,
            opportunities: finalOpportunities.sort((a, b) => b.score - a.score),
            debug: { deconstruction: deconstructionResult, seed_keywords: seedKeywords, ahrefs_results: finalKeywordData.slice(0, 20), strategic_analysis: analyzedKeywordsForDebug.map(kw => ({ keyword: kw.keyword, score: calculateStrategicScore(kw, null, kw.aiAnalysis), analysis: kw.aiAnalysis })) }
        };
    }
}

app.post('/api/analyze', (req, res) => { const jobId = uuidv4(); jobs[jobId] = { id: jobId, status: 'pending', progress: 'Job received...' }; performFullAnalysis(jobId, req.body).catch(err => { console.error(`Unhandled fatal error in job ${jobId}:`, err); jobs[jobId].status = 'error'; jobs[jobId].error = 'A critical server error occurred.'; }); res.status(202).json({ jobId }); });

app.post('/api/expand', async (req, res) => {
    const { keyword, reasoning } = req.body;
    if (!keyword) return res.status(400).json({ error: 'Keyword is required' });
    try {
        const lateralTopics = await expandLateralTopicsWithAI(keyword, reasoning);
        res.json({ lateral_topics: lateralTopics });
    } catch (error) {
        res.status(500).json({ error: 'Failed to expand topics' });
    }
});

app.post('/api/geo-insights', async (req, res) => {
    const { keyword } = req.body;
    if (!keyword) {
        return res.status(400).json({ error: 'Keyword is required' });
    }
    
    try {
        const coreConcept = await extractCoreConcept(keyword);
        console.log(`Core concept for GEO prompts: "${coreConcept}"`);

        let insights = await getGeoInsightsFromProfound(coreConcept);
        let source = 'Profound API';

        if (insights.length === 0) {
            console.log('--> Profound returned no results. Falling back to OpenAI generator.');
            insights = await generateGeoPromptsWithAI(coreConcept);
            source = 'OpenAI Simulation';
        }

        console.log(`--> Sending ${insights.length} GEO prompts from ${source}.`);
        res.json({ insights });

    } catch (error) {
        console.error('❌ Endpoint error during GEO prompt generation:', error);
        res.status(500).json({ error: 'Failed to get GEO insights' });
    }
});

app.get('/api/status/:jobId', (req, res) => { const job = jobs[req.params.jobId]; if (!job) return res.status(404).json({ error: 'Job not found' }); res.json(job); });

app.listen(PORT, () => { console.log(`🚀 Server running at http://localhost:${PORT}`); });