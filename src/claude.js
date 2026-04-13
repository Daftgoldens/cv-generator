'use strict';
const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function adaptCv(templateMd, offerContent, workMode, location) {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4000,
    system: [
      {
        type: 'text',
        text: `You are an expert CV writer specializing in ATS optimization.

You will receive a CV template in markdown and a job offer. Adapt the CV to maximize ATS score.

RULES:
- NEVER invent experience, change dates, or modify company names
- DO rewrite bullet points to incorporate exact keywords from the offer naturally
- DO rewrite the summary/profile section to directly target this specific role
- Keep the exact same markdown structure and section order as the template
- Remove any template instructions or comments (lines starting with # VERSION, FORMAT:, etc.)
- Ensure 1-page worth of content — remove sections if needed to stay tight
Return your response in this exact format and nothing else:
<company>company name from offer</company>
<role>job title from offer</role>
<cv>
full adapted CV in markdown here
</cv>`,
        cache_control: { type: 'ephemeral' }
      }
    ],
    messages: [
      {
        role: 'user',
        content: `TEMPLATE CV:\n${templateMd}\n\n---\n\nJOB OFFER:\n${offerContent}\n\n---\n\nWork mode: ${workMode}\nLocation: ${location}`
      }
    ]
  });

  const raw = response.content[0].text.trim();
  const company = (raw.match(/<company>([\s\S]*?)<\/company>/) || [])[1]?.trim() || 'Company';
  const role = (raw.match(/<role>([\s\S]*?)<\/role>/) || [])[1]?.trim() || 'Role';
  const markdown = (raw.match(/<cv>([\s\S]*?)<\/cv>/) || [])[1]?.trim() || raw;
  return { markdown, company, role };
}

async function generateCoverLetter(offerContent, language, company, role, location) {
  const isEnglish = language === 'en';
  const langInstruction = isEnglish
    ? 'Write in English.'
    : 'Écris en français.';

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2000,
    system: [
      {
        type: 'text',
        text: `You are an expert cover letter writer for Baptiste Hoffmann.

${langInstruction}

BAPTISTE'S BACKGROUND:
- Founder & CEO of Kronvex (persistent memory API for B2B AI agents, FastAPI/PostgreSQL/pgvector/Supabase/Stripe)
- Patent Data Analyst at Thales — shipped NLP/ML pipeline across 150M patents
- Data Developer Intern at Safran USA Cincinnati — automated ERP/supply chain pipelines
- Master of Engineering (Bac+5), CESI Paris, AI & Data Science
- TOEIC 920/990

WRITING RULES:
- Maximum 4 paragraphs, ~280 words total
- First sentence: specific hook about the company or role (not generic)
- Mention Kronvex and Thales (150M patents) — these are the strongest signals
- Match keywords from the offer for ATS
- Confident tone, no groveling
- End with "I'd like to talk." or "Je souhaite en discuter avec vous." depending on language

OUTPUT FORMAT (markdown):
Start with the header block, then a horizontal rule, then paragraphs, then signature.

Example structure:
# Baptiste Hoffmann
Paris, France · baptistehoffmann02@gmail.com · +33 7 82 98 80 75
linkedin.com/in/baptistehoffmann · kronvex.io

[Month Year] · [Company] — Hiring Team

---

[paragraph 1]

[paragraph 2]

[paragraph 3]

[paragraph 4 — closing]

Baptiste Hoffmann
baptistehoffmann02@gmail.com · +33 7 82 98 80 75 · kronvex.io

Return ONLY the markdown, no extra text, no code fences.`,
        cache_control: { type: 'ephemeral' }
      }
    ],
    messages: [
      {
        role: 'user',
        content: `Company: ${company}\nRole: ${role}\nLocation: ${location}\n\nJob offer:\n${offerContent}`
      }
    ]
  });

  return response.content[0].text.trim();
}

module.exports = { adaptCv, generateCoverLetter };
