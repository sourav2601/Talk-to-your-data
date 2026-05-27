import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

// Helper to safely initialize and retrieve Gemini Client lazily
let aiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error(
        "GEMINI_API_KEY is not defined. Please add your key in Settings > Secrets to enable natural language queries."
      );
    }
    aiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return aiClient;
}

// Prompt creation helpers
function buildSqlPrompt(params: {
  question: string;
  schema: string;
  sampleRows: string;
  history: Array<{ question: string; sql: string; answer: string }>;
}): string {
  const historyText = params.history && params.history.length > 0
    ? params.history
        .map(
          (h, i) =>
            `Exchange ${i + 1}:\nUser Q: ${h.question}\nGenerated SQL: ${h.sql}\nAnswer summary: ${h.answer}\n`
        )
        .join("\n")
    : "No previous conversation history.";

  return `You are an expert data analyst. You will be given a dataset schema, some sample rows, and a user question (plus previous conversation history for context). Your job is to write a correct and executable SQL query to answer the current user question.

DATASET SCHEMA:
Table name: df
Columns and data types schema info:
${params.schema}

Sample rows from the table (table name is "df"):
${params.sampleRows}

CONVERSATION HISTORY:
${historyText}

CURRENT USER QUESTION:
${params.question}

RULES FOR SQL GENERATION:
1. Return a valid, executable SQL query using standard ANSI SQL.
2. ALWAYS use "df" as the main table name. For example: "SELECT * FROM df".
3. Use correct column names EXACTLY as shown in the schema. Check spelling and casing carefully. Do not modify the column name characters.
4. For text filters, use standard equals (=) or LIKE case-insensitively if needed. Note: text matching is case sensitive by default, so wrap columns in LOWER() and search lowercase strings if appropriate (e.g., LOWER(Category) LIKE '%sales%').
5. For aggregations (e.g., SUM, AVG, COUNT, MIN, MAX), always include a proper GROUP BY clause for any non-aggregated column in the SELECT list.
6. Limit results to 50 rows unless the user explicitly asks for more or all.
7. Avoid complex platform-specific dialects. Use simple standard functions (like SUM, COUNT, AVG, ROUND, COALESCE).
8. If the current question references previous topics or is a follow-up, parse the CONVERSATION HISTORY to resolve references (e.g., "What about the second one?", "Break it down by Region").

Return both the SQL query and a short, human-friendly explanation of what the query is doing.`;
}

function buildSelfCorrectionPrompt(params: {
  question: string;
  schema: string;
  failedSql: string;
  error: string;
}): string {
  return `You are an expert SQL debugger. The SQL statement you generated previously failed during execution on the table 'df'.
Please analyze the error and generate a corrected SQL query that successfully answers the user's question.

DATASET SCHEMA:
Table Name: df
Columns and Casing:
${params.schema}

USER QUESTION:
${params.question}

FAILED SQL QUERY:
${params.failedSql}

EXECUTION ERROR RETURNED:
${params.error}

RULES FOR FIXING:
1. Fix the error. Usually, this is caused by:
   - Misspelled or incorrectly-cased column names (check schema exactly!).
   - Incorrect string wrapping (use single quotes for strings, e.g., 'Laptop' instead of "Laptop").
   - Including non-aggregated columns in a SELECT statement with an aggregation but omitting them from the GROUP BY list.
   - Using functions that are not standard (e.g. Postgres-only or MySQL-only keywords).
2. Always keep "df" as the table name.
3. Keep column casings exactly as shown in the schema.
4. If you have to specify aggregates, make sure your GROUP BY matches perfectly.

Return both the fixed SQL query and a short, helpful explanation of what was corrected.`;
}

function buildSummaryPrompt(params: {
  question: string;
  results: string;
}): string {
  return `You are a professional business intelligence analyst.
A user asked: "${params.question}"
And here are the raw data records returned by running the SQL query:
${params.results}

Please write a highly polished, conversational, and direct analysis answer summarizing these results in 1-4 sentences.
- Use friendly, human-friendly terms (e.g. round decimals, write currency markers like $ if relevant, or explain percentages).
- Highlight the key takeaway (such as the highest item, the overall sum, or the logical conclusion of the query).
- Speak directly, objectively, and avoid awkward preambles like "Based on the data..." or "Running the query shows...". Just answer directly.
- Keep the tone helpful, clear, and analytical.`;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Larger payload limits for handling larger CSV schemas/responses safely
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ extended: true, limit: "50mb" }));

  // API Route: SQL Generation
  app.post("/api/generate-sql", async (req, res) => {
    try {
      const { question, schema, sampleRows, history } = req.body;
      if (!question || !schema) {
        return res.status(400).json({ error: "Missing question or schema parameters." });
      }

      const ai = getGeminiClient();
      const promptText = buildSqlPrompt({
        question,
        schema,
        sampleRows: sampleRows || "No sample rows loaded.",
        history: history || [],
      });

      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: promptText,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              sql: {
                type: Type.STRING,
                description: "The complete, valid, executable standard SQL query.",
              },
              explanation: {
                type: Type.STRING,
                description: "A concise 1-2 sentence explanation of what this SQL query computes.",
              },
            },
            required: ["sql", "explanation"],
          },
        },
      });

      const responseText = response.text;
      if (!responseText) {
        throw new Error("Empty response received from Gemini.");
      }

      const parsed = JSON.parse(responseText.trim());
      res.json(parsed);
    } catch (err: any) {
      console.error("SQL Generation error:", err);
      res.status(500).json({ error: err.message || "Failed to generate SQL" });
    }
  });

  // API Route: SQL Self Correction
  app.post("/api/self-correct", async (req, res) => {
    try {
      const { question, schema, failedSql, error } = req.body;
      if (!question || !schema || !failedSql || !error) {
        return res.status(400).json({ error: "Missing required properties." });
      }

      const ai = getGeminiClient();
      const promptText = buildSelfCorrectionPrompt({
        question,
        schema,
        failedSql,
        error,
      });

      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: promptText,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              sql: {
                type: Type.STRING,
                description: "The corrected, valid, executable, standard SQL query.",
              },
              explanation: {
                type: Type.STRING,
                description: "A short explanation of what went wrong and how it was fixed.",
              },
            },
            required: ["sql", "explanation"],
          },
        },
      });

      const responseText = response.text;
      if (!responseText) {
        throw new Error("Empty response received from Gemini.");
      }

      const parsed = JSON.parse(responseText.trim());
      res.json(parsed);
    } catch (err: any) {
      console.error("Self correction error:", err);
      res.status(500).json({ error: err.message || "Failed to correct SQL" });
    }
  });

  // API Route: Summarize results
  app.post("/api/summarize-results", async (req, res) => {
    try {
      const { question, results } = req.body;
      if (!question || !results) {
        return res.status(400).json({ error: "Missing question or results." });
      }

      const ai = getGeminiClient();
      const rawString = typeof results === "string" ? results : JSON.stringify(results);
      const promptText = buildSummaryPrompt({
        question,
        results: rawString,
      });

      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: promptText,
      });

      const summaryText = response.text?.trim() || "No summary was generated.";
      res.json({ summary: summaryText });
    } catch (err: any) {
      console.error("Result summary error:", err);
      res.status(500).json({ error: err.message || "Failed to summarize results" });
    }
  });

  // Health check endpoint
  app.get("/api/health", (req, res) => {
    res.json({
      status: "ok",
      hasApiKey: !!process.env.GEMINI_API_KEY,
    });
  });

  // Vite middleware setup
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server is running in ${process.env.NODE_ENV || "development"} mode on http://0.0.0.0:${PORT}`);
  });
}

startServer();
