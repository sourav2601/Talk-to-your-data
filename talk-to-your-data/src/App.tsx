import React, { useState, useRef, useEffect, useMemo } from "react";
import {
  UploadCloud,
  FileSpreadsheet,
  Copy,
  Check,
  Sparkles,
  RefreshCw,
  Trash2,
  HelpCircle,
  Info,
  ChevronRight,
  ChevronLeft,
  AlertCircle,
  Terminal,
  CheckCircle2,
  Database,
  Layers,
  Search,
  MessageSquare,
  BarChart4
} from "lucide-react";
import { DatasetInfo, ChatMessage, ChatHistoryItem } from "./types";
import { parseSpreadsheetFile } from "./utils/fileParser";
import { bindDatasetToTable, executeSqlQuery, detectChartType } from "./utils/sqlExecutor";
import { AnalyticsChart } from "./components/AnalyticsChart";
import { SAMPLE_SALES_CSV } from "./data/sampleSalesData";

export default function App() {
  // Application Data States
  const [dataset, setDataset] = useState<DatasetInfo | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState("");
  const [copiedQueryId, setCopiedQueryId] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null);

  // Configuration panels
  const [dataPreviewPage, setDataPreviewPage] = useState(0);
  const [isDragActive, setIsDragActive] = useState(false);
  const [activeTab, setActiveTab] = useState<"overview" | "raw" | "schema">("overview");

  // Conversation history reference pointer for scrolling
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Health-check to verify environment setup
  useEffect(() => {
    fetch("/api/health")
      .then((res) => res.json())
      .then((data) => {
        setHasApiKey(data.hasApiKey);
      })
      .catch((err) => {
        console.error("Health check failed:", err);
        setHasApiKey(false);
      });
  }, []);

  // Scroll to bottom on chatbot expansion
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, isLoading]);

  // Handle spreadsheet file upload
  const handleFileUpload = async (file: File) => {
    setFileError(null);
    try {
      const parsedDataset = await parseSpreadsheetFile(file);
      // Bind data records to raw in-memory table `df` inside Alasql
      bindDatasetToTable(parsedDataset.rawData);
      setDataset(parsedDataset);
      setDataPreviewPage(0);

      // Welcome message customized to columns
      setChatMessages([
        {
          id: "welcome",
          question: "System Onboarding",
          sql: "",
          explanation: "",
          summary: `Successfully loaded "${parsedDataset.fileName}" with ${parsedDataset.rowCount.toLocaleString()} rows and ${parsedDataset.columnsCount} columns. I've analyzed your data and am ready to query it. Try choosing one of my recommended template questions below or write yours in plain English!`,
          timestamp: new Date().toLocaleTimeString(),
        },
      ]);
    } catch (err: any) {
      console.error("Upload process error:", err);
      setFileError(err.message || "Oops, we couldn't parse this spreadsheet. Please ensure it is a valid CSV or Excel file.");
    }
  };

  // Upload handlers
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragActive(true);
  };

  const onDragLeave = () => {
    setIsDragActive(false);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFileUpload(e.target.files[0]);
    }
  };

  // Instantly loads our mock Sales CSV string
  const handleLoadSampleSales = () => {
    const csvFile = new File([SAMPLE_SALES_CSV], "store_sales_analytics.csv", {
      type: "text/csv",
    });
    handleFileUpload(csvFile);
  };

  const clearDataset = () => {
    setDataset(null);
    setChatMessages([]);
    setFileError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // Dynamic templates suggestion based on column names/types
  const suggestedTemplates = useMemo(() => {
    if (!dataset) return [];

    const numCols = dataset.columns.filter((c) => c.type === "number").map((c) => c.name);
    const textCols = dataset.columns.filter((c) => c.type === "string").map((c) => c.name);
    const dateCols = dataset.columns.filter((c) => c.type === "date").map((c) => c.name);

    const suggestions: string[] = [];

    if (textCols.length > 0 && numCols.length > 0) {
      suggestions.push(`What is the total ${numCols[0]} by ${textCols[0]}?`);
    }
    if (textCols.length > 0 && numCols.length > 0) {
      suggestions.push(`List the top 5 ${textCols[0]} by average ${numCols[0]}`);
    }
    if (dateCols.length > 0 && numCols.length > 0) {
      suggestions.push(`Show historical trend of ${numCols[0]} over time`);
    } else if (textCols.length > 1 && numCols.length > 0) {
      suggestions.push(`What is the average ${numCols[0]} for each ${textCols[1] || textCols[0]}?`);
    } else {
      suggestions.push(`Summary metrics counting duplicate rows`);
    }

    // fallback standard generic fallback suggestions
    suggestions.push(`Show a preview of the first 10 rows from the dataset`);
    return suggestions.slice(0, 3);
  }, [dataset]);

  // Click handler for suggestion chips
  const applySuggestedQuestion = (question: string) => {
    setCurrentQuestion(question);
  };

  // Clipboard copies
  const triggerCopyAction = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedQueryId(id);
    setTimeout(() => setCopiedQueryId(null), 2000);
  };

  // Main interaction pipeline (SQL conversion + Self-Correction Loop + Chart + Summary)
  const submitQuery = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const queryStr = currentQuestion.trim();
    if (!queryStr || !dataset || isLoading) return;

    setCurrentQuestion("");
    setIsLoading(true);

    const messageId = `msg-${Date.now()}`;
    // Construct session memory (last 3 questions only as requested)
    const activeHistory: ChatHistoryItem[] = chatMessages
      .filter((m) => m.id !== "welcome" && !m.error)
      .slice(-3)
      .map((m) => ({
        question: m.question,
        sql: m.sql,
        answer: m.summary || "",
      }));

    // Schema formatting for LLM prompt context injection
    const columnSchemaText = dataset.columns
      .map(
        (c) =>
          `Column: "${c.name}" | Type: ${c.type} | Non-Null Rows: ${
            dataset.rowCount - c.nullCount
          } | Unique Value Count: ${c.uniqueCount} | Sample values: [${c.sampleValues.join(
            ", "
          )}]`
      )
      .join("\n");

    const sampleRowsText = JSON.stringify(dataset.rawData.slice(0, 3), null, 2);

    // Step 1: LLM Call to convert natural language to SQL
    setLoadingStep("Synthesizing parameters and prompting Gemini API to generate SQL query...");
    let sql = "";
    let explanation = "";
    let errorLog = "";
    let retries = 0;
    const maxRetries = 3;
    let queryResults: Record<string, any>[] = [];

    try {
      const sqlGenResponse = await fetch("/api/generate-sql", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: queryStr,
          schema: columnSchemaText,
          sampleRows: sampleRowsText,
          history: activeHistory,
        }),
      });

      if (!sqlGenResponse.ok) {
        const errorData = await sqlGenResponse.json();
        throw new Error(errorData.error || "LLM generated an invalid response status.");
      }

      const sqlGenData = await sqlGenResponse.json();
      sql = sqlGenData.sql;
      explanation = sqlGenData.explanation;

      // Ensure standard Alasql compatibility for the schema table df
      bindDatasetToTable(dataset.rawData);

      // Step 2: Try Executing SQL + Self Correction Loop
      while (retries < maxRetries) {
        try {
          setLoadingStep(
            retries === 0
              ? "Running generated SQL query on database table..."
              : `SQL query execution failed. Attempting self-correction repair (Iteration ${retries}/${maxRetries})...`
          );

          queryResults = executeSqlQuery(sql);
          // Execution succeeded! Break loop to process results.
          break;
        } catch (execErr: any) {
          retries++;
          errorLog = execErr.message || "Execution syntax error";

          if (retries >= maxRetries) {
            throw new Error(
              `SQL query execution model remains broken after maximum debug attempts. Error: ${errorLog}`
            );
          }

          // Triggering the server-side correction pipeline with error payload log
          const errorCorrectionResponse = await fetch("/api/self-correct", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              question: queryStr,
              schema: columnSchemaText,
              failedSql: sql,
              error: errorLog,
            }),
          });

          if (!errorCorrectionResponse.ok) {
            const errDetails = await errorCorrectionResponse.json();
            throw new Error(`Self-Correction repair model failed: ${errDetails.error}`);
          }

          const correctionData = await errorCorrectionResponse.json();
          sql = correctionData.sql;
          explanation = `[🔄 Self-Corrected on retry ${retries}]: ${correctionData.explanation}`;
        }
      }

      // Step 3: Result Summarization & Visual Coordinates Analysis
      setLoadingStep("Inspecting dataset records and auto-detecting chart visuals...");
      const resultColumns = queryResults.length > 0 ? Object.keys(queryResults[0]) : [];
      const chartType = detectChartType(resultColumns, queryResults, queryStr, sql);

      setLoadingStep("Asking Gemini to translate the SQL output into a conversational analysis...");
      const summaryResponse = await fetch("/api/summarize-results", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: queryStr,
          results: queryResults.slice(0, 10), // Supply sample results to keep payload lean
        }),
      });

      let summary = "";
      if (summaryResponse.ok) {
        const summaryData = await summaryResponse.json();
        summary = summaryData.summary;
      } else {
        const rowSampleText = JSON.stringify(queryResults.slice(0, 3));
        summary = `Query executed successfully and returned ${queryResults.length} records. Key indicators returned: ${rowSampleText}.`;
      }

      // Push final processed answer message to the stream
      setChatMessages((prev) => [
        ...prev,
        {
          id: messageId,
          question: queryStr,
          sql,
          explanation,
          summary,
          resultRows: queryResults,
          chartType,
          retryCount: retries,
          timestamp: new Date().toLocaleTimeString(),
        },
      ]);
    } catch (pipelineErr: any) {
      console.error("Interaction pipeline crash:", pipelineErr);
      setChatMessages((prev) => [
        ...prev,
        {
          id: messageId,
          question: queryStr,
          sql: sql || "-- Generation crash",
          explanation: "The query pipeline encountered an unrecoverable failure.",
          error: pipelineErr.message || "Failed to process data question. Let's try rephrasing for simpler metrics.",
          timestamp: new Date().toLocaleTimeString(),
        },
      ]);
    } finally {
      setIsLoading(false);
      setLoadingStep("");
    }
  };

  // Helper variables for data paging browses
  const itemsPerPage = 6;
  const paginatedRows = useMemo(() => {
    if (!dataset) return [];
    const start = dataPreviewPage * itemsPerPage;
    return dataset.rawData.slice(start, start + itemsPerPage);
  }, [dataset, dataPreviewPage]);

  const maxPreviewPage = useMemo(() => {
    if (!dataset) return 0;
    return Math.ceil(dataset.rawData.length / itemsPerPage) - 1;
  }, [dataset]);

  return (
    <div className="min-h-screen bg-[#0b0f19] text-slate-100 flex flex-col font-sans select-none antialiased">
      {/* Top Banner Contextual Warning */}
      {hasApiKey === false && (
        <div className="bg-amber-500/10 border-b border-amber-500/20 text-amber-300 px-4 py-2.5 text-xs text-center flex items-center justify-center gap-2 font-medium">
          <AlertCircle className="w-4 h-4 shrink-0 text-amber-400" />
          <span>
            API Key Missing. Please register your key under <strong>Settings &gt; Secrets</strong> panel to enable server-side Gemini generation.
          </span>
        </div>
      )}

      {/* Main App Bar Header */}
      <header className="border-b border-slate-800 bg-[#0f172a]/80 backdrop-blur-md sticky top-0 z-40 px-5 py-4">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="bg-indigo-600 p-2.5 rounded-xl text-white shadow-lg shadow-indigo-500/20 glow">
              <Database className="w-6 h-6" id="app-logo-icon" />
            </div>
            <div>
              <h1 className="text-xl font-extrabold tracking-tight text-white flex items-center gap-2">
                Talk to Your Data
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/10">
                  SQL Engine
                </span>
              </h1>
              <p className="text-xs text-slate-400 font-medium">
                Natural Language Analytics &amp; Generative Intelligence Engine
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {dataset && (
              <button
                onClick={clearDataset}
                type="button"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-500/20 bg-red-500/5 hover:bg-red-500/10 text-red-400 text-xs font-semibold transition duration-200 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Clear Dataset
              </button>
            )}
            <div className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              In-Memory DB Active
            </div>
          </div>
        </div>
      </header>

      {/* Primary Workspace Layout Grid */}
      <main className="grow max-w-7xl w-full mx-auto p-5 grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        
        {/* LEFT COLUMN: Data Workspace Manager */}
        <div className="lg:col-span-5 flex flex-col gap-6 h-full min-h-[500px]">
          
          {/* File Upload / Import Panel */}
          <div className="bg-[#111827] border border-slate-800 rounded-2xl p-5 shadow-xl flex flex-col gap-4">
            <h3 className="text-sm font-bold tracking-wider text-slate-300 uppercase flex items-center gap-2">
              <Layers className="w-4 h-4 text-indigo-400" />
              1. Spreadsheet Source Ingest
            </h3>

            {!dataset ? (
              <div className="space-y-4">
                {/* Drag and Drop Canvas */}
                <div
                  onDragOver={onDragOver}
                  onDragLeave={onDragLeave}
                  onDrop={onDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-xl p-6 flex flex-col items-center justify-center text-center cursor-pointer transition-all duration-200 group ${
                    isDragActive
                      ? "border-indigo-500 bg-indigo-500/5"
                      : "border-slate-800 hover:border-slate-700 bg-slate-900/30"
                  }`}
                >
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={onFileChange}
                    accept=".csv, .xlsx, .xls"
                    className="hidden"
                  />
                  <div className="bg-slate-800 p-3 rounded-full mb-3 text-slate-400 group-hover:text-indigo-400 group-hover:scale-110 transition duration-300">
                    <UploadCloud className="w-7 h-7" />
                  </div>
                  <p className="text-sm font-semibold text-slate-200">
                    Drag &amp; drop your spreadsheet file
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    Accepts standard CSV, XLSX, or XLS files
                  </p>
                </div>

                {/* Instant Sales Sample Load Onboarding Option */}
                <div className="text-center">
                  <span className="text-xs text-slate-500 block mb-3 font-medium">Or get started quickly</span>
                  <button
                    onClick={handleLoadSampleSales}
                    type="button"
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-indigo-500/20 bg-indigo-500/5 hover:bg-indigo-500/10 text-indigo-300 text-xs font-bold tracking-wide transition duration-200 animate-pulse shadow-md cursor-pointer"
                  >
                    <FileSpreadsheet className="w-4 h-4" />
                    ⚡ Inspect Sample Sales Dataset
                  </button>
                </div>

                {fileError && (
                  <div className="p-3 rounded-lg bg-red-500/15 border border-red-500/25 text-red-400 text-xs flex gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{fileError}</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-slate-900/40 rounded-xl p-4 border border-slate-800/80 space-y-3">
                <div className="flex items-start justify-between">
                  <div className="space-y-1 truncate pr-2">
                    <h4 className="text-sm font-bold text-white truncate" title={dataset.fileName}>
                      {dataset.fileName}
                    </h4>
                    <p className="text-[11px] font-mono text-slate-400">
                      💾 {(dataset.fileSize / 1024).toFixed(1)} KB | 👥 {dataset.rowCount.toLocaleString()} rows and {dataset.columnsCount} columns
                    </p>
                  </div>
                  <div className="bg-emerald-500/15 text-emerald-400 rounded-full px-2 py-0.5 text-[10px] font-mono font-bold tracking-wider border border-emerald-500/10">
                    PARSED
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Active Dataset Inspection Hub */}
          {dataset && (
            <div className="bg-[#111827] border border-slate-800 rounded-2xl p-5 shadow-xl flex flex-col shrink-0 grow">
              {/* Interactive Tabs Menu */}
              <div className="flex items-center border-b border-slate-800 pb-3 gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setActiveTab("overview")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                    activeTab === "overview"
                      ? "bg-slate-800 text-white border border-slate-700/50"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  📊 Data Overview
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("raw")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                    activeTab === "raw"
                      ? "bg-slate-800 text-white border border-slate-700/50"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  📝 Raw Rows Brower
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("schema")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                    activeTab === "schema"
                      ? "bg-slate-800 text-white border border-slate-700/50"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  📋 Detailed Schema
                </button>
              </div>

              {/* Tab Case 1: Overview */}
              {activeTab === "overview" && (
                <div className="grow overflow-y-auto custom-scrollbar pt-4 flex flex-col justify-between">
                  <div className="space-y-4">
                    <p className="text-xs text-slate-400 leading-relaxed font-medium">
                      The sheet metadata is fully available. This table mapping will be processed securely using the locally registered relational schema.
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-slate-900/40 p-3 rounded-xl border border-slate-800 text-center">
                        <span className="text-[10px] text-slate-500 uppercase tracking-wider font-mono block mb-1">Row count</span>
                        <span className="text-lg font-extrabold text-white font-mono">{dataset.rowCount.toLocaleString()}</span>
                      </div>
                      <div className="bg-slate-900/40 p-3 rounded-xl border border-slate-800 text-center">
                        <span className="text-[10px] text-slate-500 uppercase tracking-wider font-mono block mb-1">Columns</span>
                        <span className="text-lg font-extrabold text-white font-mono">{dataset.columnsCount}</span>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <h4 className="text-xs font-bold text-slate-300 tracking-wide uppercase">Table Columns ({dataset.columnsCount})</h4>
                      <div className="flex flex-wrap gap-1.5">
                        {dataset.columns.map((col, i) => {
                          const isNumeric = col.type === "number";
                          const isDate = col.type === "date";
                          return (
                            <span
                              key={i}
                              className={`text-[11px] px-2.5 py-1 rounded-md border font-normal font-mono flex items-center gap-1 ${
                                isNumeric
                                  ? "bg-blue-500/5 border-blue-500/10 text-blue-400"
                                  : isDate
                                  ? "bg-teal-500/5 border-teal-500/10 text-teal-400"
                                  : "bg-indigo-500/5 border-indigo-500/10 text-indigo-400"
                              }`}
                            >
                              <span className="font-bold opacity-60">
                                {isNumeric ? "#" : isDate ? "📅" : "A"}
                              </span>
                              {col.name}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  <div className="mt-6 border-t border-slate-800 pt-4 text-[10px] font-mono text-slate-500 flex items-center gap-1.5">
                    <Info className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span>Columns with spacing will be escaped using brackets like [Col Name] in SQL.</span>
                  </div>
                </div>
              )}

              {/* Tab Case 2: Raw Rows Browser */}
              {activeTab === "raw" && (
                <div className="grow overflow-hidden flex flex-col justify-between pt-4">
                  <div className="overflow-x-auto rounded-xl border border-slate-800/80 bg-slate-950/20 max-w-full grow custom-scrollbar">
                    <table className="w-full text-left border-collapse text-xs select-text">
                      <thead>
                        <tr className="bg-slate-900/80 font-mono tracking-wider text-slate-400 border-b border-slate-850">
                          {dataset.columns.slice(0, 4).map((col, idx) => (
                            <th key={idx} className="p-2 font-semibold">
                              {col.name}
                            </th>
                          ))}
                          {dataset.columnsCount > 4 && <th className="p-2">...</th>}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-850">
                        {paginatedRows.map((row, rowIdx) => (
                          <tr key={rowIdx} className="hover:bg-slate-800/20 transition-colors">
                            {dataset.columns.slice(0, 4).map((col, colIdx) => {
                              const cellValue = row[col.name];
                              return (
                                <td key={colIdx} className="p-2 text-slate-300 font-mono truncate max-w-36">
                                  {cellValue === null ? <span className="text-slate-600">null</span> : String(cellValue)}
                                </td>
                              );
                            })}
                            {dataset.columnsCount > 4 && <td className="p-2 text-slate-600 font-mono">...</td>}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Paging Actions Panel */}
                  <div className="flex items-center justify-between mt-3 text-xs shrink-0 select-none">
                    <span className="text-slate-500 font-mono">
                      Page {dataPreviewPage + 1} of {maxPreviewPage + 1}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setDataPreviewPage((p) => Math.max(0, p - 1))}
                        disabled={dataPreviewPage === 0}
                        className="p-1 px-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700/50 disabled:opacity-40 text-slate-300 disabled:pointer-events-none transition cursor-pointer"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDataPreviewPage((p) => Math.min(maxPreviewPage, p + 1))}
                        disabled={dataPreviewPage === maxPreviewPage}
                        className="p-1 px-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700/50 disabled:opacity-40 text-slate-300 disabled:pointer-events-none transition cursor-pointer"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Tab Case 3: Detailed Schema Inspector */}
              {activeTab === "schema" && (
                <div className="grow overflow-y-auto custom-scrollbar pt-4 pr-1">
                  <div className="space-y-3.5">
                    {dataset.columns.map((col, idx) => (
                      <div key={idx} className="p-3 rounded-lg border border-slate-800 bg-slate-900/25 space-y-1.5 hover:border-slate-700/60 transition">
                        <div className="flex items-center justify-between">
                          <span className="font-mono font-bold text-slate-200 text-xs">{col.name}</span>
                          <span className="font-mono text-[10px] uppercase font-semibold px-2 py-0.5 rounded bg-slate-800 text-slate-400">
                            {col.type}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 text-[10px] font-mono text-slate-500 select-all border-t border-slate-800 pt-1.5">
                          <div>Null values: <span className="text-slate-400 font-bold">{col.nullCount}</span></div>
                          <div>Unique items: <span className="text-slate-400 font-bold">{col.uniqueCount}</span></div>
                        </div>
                        <div className="text-[10px] font-mono text-slate-500 flex items-center gap-1">
                          <span className="semibold shrink-0">Sample distribution:</span>
                          <span className="text-indigo-400 truncate font-semibold">[{col.sampleValues.join(", ")}]</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* RIGHT COLUMN: Chatbot Intelligence Console */}
        <div className="lg:col-span-7 flex flex-col h-full h-[650px] lg:h-auto bg-[#111827] border border-slate-800 rounded-3xl overflow-hidden shadow-2xl">
          
          {/* Output Header Status */}
          <div className="bg-[#1f2937]/50 border-b border-slate-800 p-4 shrink-0 flex items-center justify-between px-5">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-indigo-400 animate-pulse" />
              2. Interactive Analytics Chat
            </h3>
            {dataset && (
              <span className="font-mono text-[10px] text-slate-400 font-semibold bg-indigo-500/10 border border-indigo-500/15 text-indigo-300 px-2 py-0.5 rounded-full select-all">
                Table: df (Relational mapped)
              </span>
            )}
          </div>

          {/* Interactive Chat Log Output Panel */}
          <div className="grow p-5 overflow-y-auto custom-scrollbar flex flex-col gap-5 select-text">
            {!dataset ? (
              <div className="grow flex flex-col items-center justify-center text-center p-6 space-y-4">
                <div className="bg-slate-800/50 p-4 rounded-full text-indigo-400/80 max-w-fit shadow-lg shadow-indigo-500/5 glow">
                  <Sparkles className="w-8 h-8" />
                </div>
                <div className="space-y-1 max-w-md">
                  <h4 className="text-sm font-bold text-white">Ask Anything to Your Spreadsheets</h4>
                  <p className="text-xs text-slate-400 leading-relaxed font-semibold">
                    Provide a CSV or Excel worksheet in the database loader first. Once mapped, you can explore columns, plot layouts, aggregations, ratios, trendlines, and percentages using plain English questions without needing to program any raw queries or code.
                  </p>
                </div>
              </div>
            ) : chatMessages.length === 0 ? (
              <div className="grow flex items-center justify-center text-center p-6 text-slate-500 text-xs">
                Ask a question to begin calculations.
              </div>
            ) : (
              chatMessages.map((msg) => {
                const isSystemOnboard = msg.id === "welcome";
                const isError = !!msg.error;

                return (
                  <div key={msg.id} className="space-y-3.5 border-b border-indigo-500/5 pb-5">
                    
                    {/* User Question bubble (except welcome intro) */}
                    {!isSystemOnboard && (
                      <div className="flex items-start gap-2.5 justify-end">
                        <div className="bg-indigo-600 rounded-2xl rounded-tr-sm p-3.5 max-w-[85%] text-xs shadow-md shadow-indigo-500/5 select-text hover:bg-indigo-600/90 transition">
                          <p className="font-semibold text-white leading-relaxed">{msg.question}</p>
                          <span className="text-[9px] text-indigo-300 font-mono block text-right mt-1.5 font-medium select-none">
                            {msg.timestamp}
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Bot Answer card */}
                    <div className="flex items-start gap-2.5">
                      <div className="bg-slate-900/50 border border-slate-800/85 rounded-2xl p-4 sm:p-5 w-full space-y-4 shadow-sm relative overflow-hidden group">
                        
                        {/* Summary Narrative response */}
                        <div className="space-y-1.5 select-text">
                          <div className="flex items-center gap-1.5 text-xs font-bold text-indigo-400 select-none">
                            <Sparkles className="w-3.5 h-3.5 animate-pulse shrink-0" />
                            <span>Analysis Response</span>
                          </div>
                          
                          {isError ? (
                            <div className="p-3 bg-red-500/10 border border-red-500/15 rounded-xl text-xs text-red-400 flex gap-2 leading-relaxed">
                              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-400" />
                              <div className="space-y-1">
                                <span className="font-bold">Execution Error:</span>
                                <p className="font-mono text-[11px] font-semibold break-words">{msg.error}</p>
                              </div>
                            </div>
                          ) : (
                            <p className="text-slate-200 text-xs md:text-sm font-semibold leading-relaxed">
                              {msg.summary}
                            </p>
                          )}
                        </div>

                        {/* Rendering dynamic Interactive Charts */}
                        {!isError && msg.chartType && msg.chartType !== "none" && msg.resultRows && (
                          <div className="pt-2 select-all">
                            <AnalyticsChart
                              type={msg.chartType}
                              data={msg.resultRows}
                              question={msg.question}
                            />
                          </div>
                        )}

                        {/* SQL Code Explainer Panel (Collapsible metadata query card) */}
                        {!isSystemOnboard && !isError && msg.sql && (
                          <div className="border border-slate-800/80 rounded-xl bg-slate-950/40 divide-y divide-slate-800 overflow-hidden">
                            <div className="flex items-center justify-between p-2.5 px-3.5 text-xs bg-slate-900/60 text-slate-300 font-mono select-none">
                              <span className="text-[10px] uppercase tracking-widest font-bold text-slate-500 flex items-center gap-1.5">
                                <Terminal className="w-3.5 h-3.5" />
                                Compiled Relational Query
                              </span>
                              
                              <button
                                type="button"
                                onClick={() => triggerCopyAction(msg.sql, msg.id)}
                                className="inline-flex items-center gap-1 text-[10px] font-mono hover:text-white px-2 py-0.5 rounded border border-slate-800 bg-slate-950/80 transition uppercase tracking-wide cursor-pointer"
                              >
                                {copiedQueryId === msg.id ? (
                                  <>
                                    <Check className="w-3 h-3 text-emerald-400" />
                                    Copied
                                  </>
                                ) : (
                                  <>
                                    <Copy className="w-3 h-3" />
                                    Copy SQL
                                  </>
                                )}
                              </button>
                            </div>

                            <div className="p-3 select-all">
                              <pre className="text-[11px] font-mono text-indigo-300 leading-relaxed overflow-x-auto whitespace-pre-wrap select-text break-words pr-2 max-w-full">
                                {msg.sql}
                              </pre>
                            </div>

                            {msg.explanation && (
                              <div className="p-3 bg-slate-900/25 flex gap-2 select-text">
                                <Info className="w-3.5 h-3.5 text-slate-500 shrink-0 mt-0.5" />
                                <div className="space-y-0.5 text-xs text-slate-400 font-medium">
                                  <span className="font-bold text-[10px] uppercase tracking-wider text-slate-500 select-none block">
                                    Logic Breakdown
                                  </span>
                                  <p>{msg.explanation}</p>
                                </div>
                              </div>
                            )}

                            {/* Self correction Badge indicator notification */}
                            {msg.retryCount !== undefined && msg.retryCount > 0 && (
                              <div className="p-2 px-3 text-[10px] font-mono font-bold text-emerald-400 bg-emerald-500/5 flex items-center gap-1.5 border-t border-slate-800">
                                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                                🔄 SQL debug self-repair pipeline successfully debugged syntax on compile attempt {msg.retryCount}!
                              </div>
                            )}
                          </div>
                        )}

                        {/* Database record mapping output Grid display */}
                        {!isSystemOnboard && !isError && msg.resultRows && msg.resultRows.length > 0 && (
                          <div className="space-y-1.5 select-text">
                            <span className="text-[10px] uppercase tracking-widest font-bold text-slate-500 font-mono select-none block">
                              Returned Query ResultSet (First 8 Rows)
                            </span>
                            <div className="overflow-x-auto rounded-xl border border-slate-800 hover:border-slate-700/60 transition bg-slate-950/20 custom-scrollbar max-w-full">
                              <table className="w-full text-left border-collapse text-[10px] font-mono">
                                <thead>
                                  <tr className="bg-slate-900/80 text-slate-400 border-b border-slate-850">
                                    {Object.keys(msg.resultRows[0]).map((h, i) => (
                                      <th key={i} className="p-2 font-semibold">
                                        {h}
                                      </th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-850">
                                  {msg.resultRows.slice(0, 8).map((row, rIdx) => (
                                    <tr key={rIdx} className="hover:bg-slate-800/10 transition-colors text-slate-300">
                                      {Object.values(row).map((val, cIdx) => (
                                        <td key={cIdx} className="p-2 truncate max-w-28 text-slate-200">
                                          {val === null ? <span className="text-slate-600">null</span> : String(val)}
                                        </td>
                                      ))}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                            {msg.resultRows.length > 8 && (
                              <span className="text-[10px] font-mono text-slate-500 italic block mt-1">
                                * Dataset output truncated. {msg.resultRows.length - 8} more matching records omitted for spacing details.
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}

            {/* Dynamic Step-by-Step progress calculations loader representation */}
            {isLoading && (
              <div className="flex items-start gap-2.5">
                <div className="bg-slate-900/50 border border-slate-800/80 rounded-2xl p-4 sm:p-5 w-full flex items-center gap-4 text-xs font-semibold shadow-sm overflow-hidden text-slate-400">
                  <RefreshCw className="w-4 h-4 text-indigo-400 animate-spin shrink-0" />
                  <div className="space-y-1 grow">
                    <span className="text-indigo-400 font-bold block animate-pulse uppercase tracking-widest text-[9px] font-mono">
                      Query Execution Flow
                    </span>
                    <p className="text-slate-300 font-medium text-xs">
                      {loadingStep}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Empty target pointer for tracking scrolling viewport */}
            <div ref={messagesEndRef} />
          </div>

          {/* Prompt Recommendations Panel & Suggestions Chips */}
          {dataset && (
            <div className="p-4 bg-slate-900/20 border-t border-slate-800 space-y-2.5 shrink-0 select-none">
              <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider font-mono flex items-center gap-1">
                <BarChart4 className="w-3.5 h-3.5 text-indigo-400" />
                Select Suggested Analysis
              </span>
              <div className="flex flex-wrap gap-2">
                {suggestedTemplates.map((template, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => applySuggestedQuestion(template)}
                    disabled={isLoading}
                    className="inline-flex items-center text-left text-xs bg-slate-900 shadow hover:bg-slate-800 hover:border-slate-700/80 text-indigo-300 border border-slate-800 px-3.5 py-2 rounded-xl transition cursor-pointer font-semibold max-w-full truncate disabled:opacity-40 disabled:pointer-events-none"
                    title={template}
                  >
                    💡 {template}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Core Submit Input Panel bar */}
          <div className="p-4 bg-slate-900/50 border-t border-slate-800 shrink-0">
            <form onSubmit={submitQuery} className="flex gap-2 w-full">
              <input
                type="text"
                disabled={!dataset || isLoading}
                value={currentQuestion}
                onChange={(e) => setCurrentQuestion(e.target.value)}
                placeholder={
                  !dataset
                    ? "Injest a CSV or Excel worksheet on the left config panel to query database records..."
                    : "Ask about totals, aggregates, top items, trends, averages in plain English..."
                }
                className="grow bg-slate-950/70 border border-slate-800/80 rounded-2xl px-4 py-3 text-xs md:text-sm font-semibold text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 disabled:opacity-40 select-all transition"
              />
              <button
                type="submit"
                disabled={!dataset || !currentQuestion.trim() || isLoading}
                className="bg-indigo-600 hover:bg-indigo-500 p-3 sm:px-6 sm:py-3 rounded-2xl text-white hover:scale-[1.02] active:scale-[0.98] disabled:scale-100 font-bold tracking-wider text-xs flex items-center justify-center gap-2 shadow-lg hover:shadow-indigo-500/20 transition disabled:opacity-40 disabled:pointer-events-none cursor-pointer duration-100 shrink-0"
              >
                <Sparkles className="w-4 h-4" />
                <span className="hidden sm:inline">Ask AI</span>
              </button>
            </form>
          </div>
        </div>
      </main>

      {/* Tidy human-friendly Footer */}
      <footer className="border-t border-slate-800 py-4 text-center text-[10px] font-mono text-slate-500 select-none bg-[#090d16]">
        Talk to Your Data — powered by Gemini 3.5 Flash &amp; in-memory relational SQL tables
      </footer>
    </div>
  );
}
