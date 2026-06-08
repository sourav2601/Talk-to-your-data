# 📊 Talk to Your Data

> Query any dataset in plain English. No SQL needed.

---

## What it does

Upload any CSV or Excel file and ask questions in plain English:

- *"Which region had the highest revenue?"*
- *"Show monthly sales trend for 2024"*
- *"Compare 2023 vs 2024 by region"*

The app generates SQL, runs it, and returns an answer + chart instantly.

---

## Features

- Natural language to SQL using Gemini API
- Auto chart selection (bar, line, pie, scatter)
- Self-correcting SQL (retries up to 3 times on failure)
- Conversation memory for follow-up questions
- Works on any CSV or Excel dataset

---

## Tech Stack

| Layer | Tech |
|---|---|
| Frontend | React + TypeScript |
| Backend | Node.js + Express |
| LLM | Google Gemini API |
| SQL Engine | AlaSQL (in-memory) |
| Deployment | Render |

---

## Local Setup

```bash
git clone https://github.com/sourav2601/Talk-to-your-data.git
cd Talk-to-your-data/talk-to-your-data
npm install
```

Create `.env` file:
```
GEMINI_API_KEY=your_key_here
```

```bash
npm run dev
```

---

## Author

**Sourav Prasad** — B.Tech CSE, KIIT University (2026)
📧 souravprasad2004@gmail.com | [GitHub](https://github.com/sourav2601)
