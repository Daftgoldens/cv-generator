# CV Generator — Auto-pipeline

Pipeline complet et semi-automatique de candidatures :
**scrape → score (A-F) → génère CV+lettre adaptés → notifie → tu valides**

## Quoi de neuf (branche `feature/auto-pipeline`)

Cette branche ajoute l'automatisation complète au système existant, sans casser ton workflow manuel.

### Nouveautés

1. **Scrapers job boards** : LinkedIn (guest, anti-ban), Welcome to the Jungle (Algolia), Indeed (Playwright), HelloWork (HTML).
2. **Scanner ATS étendu** : config en DB Supabase au lieu de `portals.yml` local (avec fallback).
3. **Cron scheduler** : node-cron service séparé, lance scan→évalue→génère→notifie automatiquement.
4. **Notifications Telegram** avec boutons inline (Approuver / Skip / Voir CV / Voir Offre).
5. **Email digest quotidien** via Resend.
6. **Storage Supabase** : CV+lettres générés auto sont stockés et accessibles via lien public.
7. **Onglet "Auto"** dans le dashboard pour gérer settings, voir les runs, toggle les recherches.

## Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│  RAILWAY                                                           │
│  ┌──────────────────┐  ┌──────────────────┐  ┌───────────────────┐ │
│  │  web (express)   │  │  cron (node-cron)│  │  bot (telegram)   │ │
│  │  - Dashboard     │  │  - scan-ats      │  │  - poll callbacks │ │
│  │  - API endpoints │  │  - scan-boards   │  │  - approve/skip   │ │
│  │  - SSE manuels   │  │  - batch-eval    │  │                   │ │
│  │                  │  │  - generate-docs │  │                   │ │
│  │                  │  │  - daily-digest  │  │                   │ │
│  └────────┬─────────┘  └────────┬─────────┘  └─────────┬─────────┘ │
└───────────┼─────────────────────┼──────────────────────┼───────────┘
            │                     │                      │
            └─────────────────────┴──────────────────────┘
                                  │
                                  ▼
                         ┌────────────────┐
                         │  Supabase      │
                         │  - tables      │  pipeline, applications
                         │  - storage     │  PDFs (CV + lettres)
                         │                │  tracked_companies
                         │                │  scraper_searches
                         │                │  cron_runs
                         │                │  auto_settings
                         └────────────────┘
                                  │
                                  ▼
                         ┌────────────────┐
                         │  Anthropic API │
                         │  - evaluate    │  scoring A-F
                         │  - adaptCv     │  CV adapté
                         │  - coverLetter │  lettre adaptée
                         └────────────────┘

  Sources d'offres :
  ┌─────────────────────────┐    ┌──────────────────────────────┐
  │  ATS scanner (Greenhse, │    │  Job boards scrapers         │
  │  Ashby, Lever)          │    │  - LinkedIn (guest)          │
  │  → 100% légal           │    │  - WTTJ (Algolia)            │
  │  → recommandé           │    │  - Indeed (Playwright)       │
  │                         │    │  - HelloWork (HTML)          │
  └─────────────────────────┘    └──────────────────────────────┘
```

## Setup

### 1. Migration DB

Dans Supabase Studio → SQL Editor → exécuter `db/migration_001_auto_pipeline.sql`.

Crée aussi un bucket Storage appelé `applications` (public read).

### 2. Seed initial des entreprises trackées et recherches

```bash
npm install
npm run seed
```

Idempotent : tu peux le relancer, il ne crée pas de doublons. Tu peux aussi éditer `config/portals.seed.yml` et `config/searches.seed.yml` puis re-seed pour ajouter de nouvelles entrées.

### 3. Variables d'env

Ajouter à ton `.env` (et sur Railway) :

```bash
# Existant (déjà configuré dans ton repo)
PASSWORD=...
SESSION_SECRET=...
SUPABASE_URL=...
SUPABASE_ANON_KEY=...
ANTHROPIC_API_KEY=...

# Nouveau : storage
SUPABASE_SERVICE_ROLE_KEY=...        # nécessaire pour upload PDF
SUPABASE_STORAGE_BUCKET=applications

# Nouveau : Telegram bot
TELEGRAM_BOT_TOKEN=...               # @BotFather
TELEGRAM_CHAT_ID=...                 # ton chat_id (cf. ci-dessous)

# Nouveau : Email digest (Resend)
RESEND_API_KEY=...                   # https://resend.com
EMAIL_FROM=baptiste@kronvex.io       # domaine vérifié dans Resend
EMAIL_TO=baptiste@kronvex.io

# Nouveau : WTTJ scraper (Algolia)
WTTJ_ALGOLIA_API_KEY=...             # à sniffer depuis welcometothejungle.com (voir scraper)

# Nouveau : sécurité cron HTTP
CRON_SECRET=...                      # token random pour déclencher /api/cron/* via HTTP

# Nouveau : URL publique pour les liens dans les notifs
PUBLIC_BASE_URL=https://cv-generator-bh.up.railway.app

# Optionnel
TZ=Europe/Paris
```

#### Setup Telegram bot

1. Sur Telegram, ouvre `@BotFather` → `/newbot` → suis les étapes → note le TOKEN
2. Envoie un message à ton bot
3. Visite `https://api.telegram.org/bot<TOKEN>/getUpdates`
4. Récupère `result[0].message.chat.id` → c'est ton `TELEGRAM_CHAT_ID`

#### Setup Resend (email digest)

1. Crée un compte sur https://resend.com
2. Vérifie ton domaine (kronvex.io)
3. Crée une API key

#### Setup WTTJ (clé Algolia)

WTTJ utilise une clé Algolia publique côté front. Pour la récupérer :
1. Va sur https://www.welcometothejungle.com/fr/jobs?query=data+engineer
2. DevTools → Network → filtre "algolia.net"
3. Repère une requête, copie le header `X-Algolia-API-Key`
4. La clé tourne périodiquement, à rafraîchir si le scraper retourne 0 résultats

### 4. Déploiement Railway

Tu as **3 services** à créer dans le même projet Railway, tous pointant sur ce repo :

| Service | Start Command | Always-on |
|---------|---------------|-----------|
| `web` (existant) | `node server.js` | ✅ |
| `cron` (nouveau) | `node src/cron/scheduler.js` | ✅ |
| `bot` (nouveau) | `node src/notifier/telegram-bot.js` | ✅ |

Tous partagent les mêmes variables d'env. Le service `web` reste public (port exposé), les deux autres tournent en worker (pas de port).

### 5. Test en local

```bash
npm run dev          # démarre le web (server.js) — déjà existant
npm run cron         # démarre le scheduler dans une autre terminal
npm run bot          # démarre le bot Telegram dans une autre terminal

# Déclencher un job manuellement :
curl -X POST -H "x-cron-secret: $CRON_SECRET" http://localhost:3000/api/cron/scan-ats
```

## Schedule cron (heure de Paris)

| Heure | Job |
|-------|-----|
| 06:00, 12:00, 18:00 | scan-ats |
| 07:00, 13:00, 19:00 | scan-boards |
| 08:00, 14:00, 20:00 | batch-evaluate |
| 09:00, 15:00, 21:00 | generate-docs |
| 09:30 | daily-digest |

Modifiable dans `src/cron/scheduler.js`.

## Coûts estimés

| Item | Coût mensuel |
|------|--------------|
| Railway (3 services) | ~15-20€ |
| Anthropic API (scoring + génération) | ~5-10$ |
| Resend (3000 emails/mois gratuits) | 0€ |
| Supabase (free tier suffisant pour ce volume) | 0€ |
| **Total** | **~25€/mois** |

## Sécurité & risques

### Risque LinkedIn ban : faible mais non nul

- **Pas de scraping authentifié** : on utilise uniquement l'endpoint guest public.
- **Pas d'Easy Apply automatique** : on génère les docs et te donne le lien.
- **Rate limiting agressif** : 1 requête / 15 secondes, 30 jobs max/run.
- **HTTP 429/999 = abort immédiat** : si LinkedIn signale rate-limit, le scraper s'arrête.
- **User-Agent rotatif** : pas un seul UA fixe.

Si tu vois ton IP Railway bloquée par LinkedIn (réponses vides systématiques) :
- soit tu acceptes la perte (les autres scrapers + ton scanner ATS continuent de marcher)
- soit tu mets un proxy résidentiel (Bright Data ~$500/mois — overkill pour un use case perso)

### Recommandation : favorise le scanner ATS

Ton scanner ATS (Greenhouse/Ashby/Lever) **ne pose aucun problème légal ou technique** : ce sont des APIs publiques destinées aux job boards. Tu y gagnes plus en ajoutant des entreprises là (via `tracked_companies`) qu'en scrapant LinkedIn.

## Tables Supabase à créer

Toutes les nouvelles tables sont dans `db/migration_001_auto_pipeline.sql` :

- `tracked_companies` (remplace portals.yml)
- `title_filters`
- `scraper_searches`
- `cron_runs`
- `auto_settings`

Et extensions de tables existantes :
- `pipeline` : ajout de `source`, `company`, `location`, `posted_at`, `source_id`, `fingerprint`
- `applications` : ajout de `cv_pdf_url`, `cover_letter_pdf_url`, `auto_generated`, `reviewed_at`

## Ce qui reste à faire (V2)

- [ ] Auto-submit Easy Apply LinkedIn (avec session authentifiée → risque ban élevé)
- [ ] Tracking des réponses entreprises via parsing email Gmail
- [ ] Apprentissage des préférences à partir des approve/skip pour améliorer le scoring
- [ ] Ajout de SEEK (AU), Wantedly (JP), JobStreet (SG) en V2
- [ ] Détection de doublons cross-platform améliorée (LLM-based)
- [ ] Stats : taux de score, taux d'approbation, taux de réponse
