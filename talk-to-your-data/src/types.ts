export interface ColumnSchema {
  name: string;
  type: "number" | "string" | "date" | "boolean";
  sampleValues: any[];
  nullCount: number;
  uniqueCount: number;
}

export interface DatasetInfo {
  fileName: string;
  fileSize: number;
  rowCount: number;
  columnsCount: number;
  columns: ColumnSchema[];
  rawData: Record<string, any>[];
}

export interface ChatMessage {
  id: string;
  question: string;
  sql: string;
  explanation: string;
  error?: string;
  summary?: string;
  resultRows?: Record<string, any>[];
  chartType?: "bar" | "line" | "pie" | "scatter" | "none";
  chartData?: any[];
  retryCount?: number;
  timestamp: string;
}

export interface ChatHistoryItem {
  question: string;
  sql: string;
  answer: string;
}
