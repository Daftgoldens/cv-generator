'use strict';
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const PROMPTS_DIR = path.join(__dirname, 'prompts');
const DATA_DIR = path.join(__dirname, '..', 'data');

function loadPrompt(filename) {
  return fs.readFileSync(path.join(PROMPTS_DIR, filename), 'utf8');
}

function loadCv() {
  return fs.readFileSync(path.join(DATA_DIR, 'cv.md'), 'utf8');
}

// Streams evaluation blocks A-F. Calls onChunk(text) for each text delta.
// Returns the full accumulated text when done.
async function evaluate(offerContent, language, onChunk) {
  const lang = language === 'fr' ? 'fr' : 'en';
  const evaluateMode = lang === 'fr'
    ? loadPrompt('evaluate-fr.md')
    : loadPrompt('evaluate-en.md');
  const sharedContext = lang === 'fr' ? loadPrompt('shared-fr.md') : '';
  const profileContext = loadPrompt('profile.md');
  const cvContent = loadCv();

  const systemPrompt = [
    sharedContext,
    profileContext,
    `## CV du candidat\n\n${cvContent}`,
    evaluateMode,
    `## Instruction finale\n\nAprès le Bloc F, génère OBLIGATOIREMENT une ligne JSON (sur une seule ligne) au format suivant — ne l'entoure pas de backticks ni de balises markdown :\n{"score": X.X, "company": "Nom exact de l'entreprise", "role": "Titre exact du poste", "keywords": ["kw1", "kw2", "kw3", ...15-20 mots-clés ATS]}`,
  ].filter(Boolean).join('\n\n---\n\n');

  const stream = client.messages.stream({
    model: 'claude-sonnet-4-6',
    max_tokens: 8000,
    system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: `Évalue cette offre :\n\n${offerContent}` }],
  });

  let fullText = '';
  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      const text = event.delta.text;
      fullText += text;
      onChunk(text);
    }
  }
  return fullText;
}

// Generates an ATS-optimized CV as structured JSON with HTML sections.
async function adaptCv(offerContent, keywords, workMode, location, lang) {
  const pdfMode = loadPrompt('pdf-mode.md');
  const cvContent = loadCv();

  // === Strict language instruction (FIRST line of system prompt) ===
  // This is critical: without it, the model can drift to French because
  // the rest of the prompt structure is in French.
  const langInstruction = lang === 'en'
    ? `# OUTPUT LANGUAGE: ENGLISH

**ALL output text MUST be in English.** This includes:
- The "summary" paragraph
- All bullet points in experience and projects
- All descriptions, role titles, and skill categories
- The text inside "skill-category" spans (e.g. "Analytics & BI:" not "Analytique & BI :")
- All competencies

The candidate (Baptiste) is bilingual. Even though the candidate CV source contains some French, you MUST translate everything to natural, professional English. Use US English spelling (organize, analyze, color).

---

`
    : `# LANGUE DE SORTIE : FRANÇAIS — FORMAT 1 PAGE STRICTEMENT

**Toute la sortie doit être en français.** Cela inclut les bullets, descriptions, titres de rôles, catégories de skills, summary, et compétences.

## CONTRAINTE ABSOLUE : 1 PAGE A4 (marges 0.5in)

Le CV DOIT tenir en UNE seule page A4. Respecte ces limites strictes :

- **Profil (summary)** : 2-3 lignes max, 50 mots max
- **Expériences** : 3 bullets max par poste, 12 mots max par bullet
- **Projets** : retourne une chaîne HTML vide `""` — ne génère PAS de section projets
- **Formation** : 1 ligne par diplôme + 1 ligne de description max
- **Certifications** : max 3 certifications, 1 ligne chacune
- **Compétences** : max 5 catégories, 4-5 items par catégorie
- **Compétences clés** : 6 éléments max

Si tu génères trop de contenu, le CV déborde sur 2 pages — c'est un échec critique.

---

`;

  const systemPrompt = `${langInstruction}## CV du candidat (source de vérité — ne jamais inventer)

${cvContent}

---

## Règles de génération

${pdfMode}

---

## Format de sortie OBLIGATOIRE

Retourne UNIQUEMENT un objet JSON valide, sans backticks, sans texte avant ou après.
Les sections experience, projects, education, certifications, skills sont du HTML pur.

Structure HTML attendue pour experience :
\`\`\`
<div class="job">
  <div class="job-header">
    <div class="job-title-company">
      <span class="job-title">Title</span>
      <span class="separator">·</span>
      <span class="company">Company</span>
      <span class="separator">|</span>
      <span class="location">Location</span>
    </div>
    <span class="date">Start – End</span>
  </div>
  <ul>
    <li>Bullet with <strong>metric</strong> integrated</li>
  </ul>
</div>
\`\`\`

Structure pour competencies (tableau de strings, pas du HTML) :
["keyword1", "keyword2", ...]  (6-8 éléments max, issus du JD)

Structure HTML pour education :
\`\`\`
<div class="edu-item">
  <div class="edu-header">
    <div><span class="edu-title">Degree</span> · <span class="edu-org">School</span></div>
    <span class="edu-year">Years</span>
  </div>
  <div class="edu-desc">Capstone description if relevant</div>
</div>
\`\`\`

Structure HTML pour certifications :
\`\`\`
<div class="cert-item">
  <span class="cert-title">Name <span class="cert-org">Issuer</span></span>
  <span class="cert-year">Year</span>
</div>
\`\`\`

Structure HTML pour skills :
\`\`\`
<div class="skills-grid">
  <span class="skill-item"><span class="skill-category">Category:</span> item1 · item2</span>
</div>
\`\`\`

JSON à retourner :
{
  "company": "...",
  "role": "...",
  "lang": "${lang}",
  "summary": "summary paragraph adapted to the offer",
  "competencies": ["kw1", "kw2"],
  "experience": "<html>",
  "projects": "<html>",
  "education": "<html>",
  "certifications": "<html>",
  "skills": "<html>"
}`;

  const userMsg = `Job offer:\n${offerContent}\n\nATS keywords to integrate: ${(keywords || []).join(', ')}\nWork mode: ${workMode}\nLocation: ${location}\nOutput language: ${lang}`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 6000,
    system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: userMsg }],
  });

  const raw = response.content[0].text.trim();
  const jsonStr = raw.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
  return JSON.parse(jsonStr);
}

// Generates a cover letter as HTML paragraphs (<p> tags only, no header/signature).
async function generateCoverLetter(offerContent, language, company, role, location) {
  const isEnglish = language === 'en';

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2000,
    system: [
      {
        type: 'text',
        text: `You are writing a cover letter for Baptiste Hoffmann.
${isEnglish ? 'Write in English (US English spelling).' : 'Écris en français.'}

BAPTISTE'S BACKGROUND:
- Founder & CEO of Kronvex — persistent memory API for B2B AI agents. p50 latency <55ms, 99.9% uptime, GDPR-native. Stack: FastAPI, PostgreSQL, pgvector, Supabase, Stripe, Cloudflare.
- Patent Data Analyst at Thales (3-year apprenticeship) — NLP/ML pipeline across 150M patents, Power BI dashboards for legal/R&D/exec teams.
- Data Developer Intern at Safran USA, Cincinnati — supply chain analytics, Python/SQL automation, Power BI KPI dashboards.
- Master of Engineering (Bac+5), CESI Paris, AI & Data Science.
- TOEIC 920/990.

RULES:
- Max 4 paragraphs, ~280 words total
- First sentence: specific hook about the company or this role (not generic)
- Paragraph 2-3: Kronvex + Thales (150M patents) are the strongest signals — use them
- Match JD keywords for ATS
- Confident tone, no groveling
- End with: "I'd like to talk." (EN) or "Je souhaite en discuter avec vous." (FR)

OUTPUT FORMAT: HTML paragraphs only — just <p> tags, no header, no signature.
Example:
<p>First paragraph...</p>
<p>Second paragraph...</p>
<p>Third paragraph...</p>
<p>Closing paragraph. I'd like to talk.</p>

Return ONLY the HTML paragraphs, nothing else.`,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [
      { role: 'user', content: `Company: ${company}\nRole: ${role}\nLocation: ${location}\n\nJob offer:\n${offerContent}` },
    ],
  });

  return response.content[0].text.trim();
}

module.exports = { evaluate, adaptCv, generateCoverLetter };
