# Nook
### Your little corner of the internet.

**Nook is an AI-powered personal knowledge organizer that transforms scattered bookmarks and saved resources into an organized, searchable personal library.**

Instead of simply collecting links and leaving users to organize them manually, Nook uses AI to understand saved resources, generate relevant categories and tags, summarize content, and suggest thematic collections. A browser extension makes capturing resources part of everyday browsing, while the web application provides a central place to revisit and manage them.

Save less time organizing. Spend more time discovering.

## Features

### AI-powered resource understanding

Nook doesn't stop at storing a URL. It processes saved resources to understand what they contain.

- **Automatic categorization:** AI analyzes resource metadata and extracted content to assign meaningful categories, reusing existing user categories where appropriate.
- **Contextual tagging:** Generates relevant tags to make saved resources easier to organize and revisit.
- **Content summarization:** Produces concise summaries grounded in the extracted resource content.
- **Two-stage classification:** Begins with available webpage metadata and can subsequently enrich the classification using extracted content.
- **Structured AI output:** Validates model responses against strict schemas before persisting classifications.

### Personalized organization

Nook is designed to adapt to how users organize information.

- **User corrections:** Users can correct AI-generated categories and tags.
- **Correction-aware classification:** Relevant previous corrections are retrieved and supplied as contextual examples during subsequent classification.
- **Category consistency:** A taxonomy normalization layer handles equivalent category names and common naming variations.
- **Manual preference protection:** AI-generated classifications do not overwrite manually selected categories.

### Browser extension

Save resources without interrupting your browsing.

The Chrome extension allows users to:

- Register and log in to Nook.
- Save the currently active webpage.
- Capture its URL, title and description.
- Receive saving, processing, duplicate and error feedback.
- Open the Nook web application directly.

### Technology stack

| Layer | Technologies |
|---|---|
| Frontend | React, TypeScript, Vite |
| Backend | Node.js, Express 5, TypeScript |
| Database | PostgreSQL |
| ORM | Prisma |
| Validation | Zod |
| Authentication | JWT, bcryptjs |
| AI integration | OpenAI-compatible API, custom provider abstraction |
| Content extraction | Cheerio, pdf-parse |
| Browser extension | Chrome Manifest V3, JavaScript |
| Testing | Vitest, Supertest |

---

## Getting started

### Prerequisites

- Node.js 20.18.1 or later
- npm
- Docker Desktop
- Chrome or Edge (for the browser extension)

### 1. Clone the repository

```bash
git clone https://github.com/YOUR_USERNAME/nook.git
cd nook
```

### 2. Install dependencies

```bash
npm install
npm --prefix web install
```

### 3. Configure environment variables

Create your local environment file:

**PowerShell**

```powershell
Copy-Item .env.example .env
```

Configure the required variables.

### 4. Start PostgreSQL

```bash
npm run db:up
```

### 5. Generate Prisma Client and run migrations

```bash
npm run prisma:generate
npm run prisma:migrate -- --name init
```

### 6. Start the backend

```bash
npm run dev
```

The backend runs at:

`http://localhost:3000`

### 7. Start the web application

Open another terminal:

```bash
npm run web:dev
```

The frontend runs at:

`http://localhost:5173`

Vite proxies API requests to the local backend.

---

## Running the browser extension

1. Start the backend and web application.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode**.
4. Select **Load unpacked**.
5. Choose the repository's `extension/` directory.
6. Pin Nook to the browser toolbar.
7. Register or log in and save a webpage.

The extension uses the local backend by default. Its API origin can also be configured through extension settings.

