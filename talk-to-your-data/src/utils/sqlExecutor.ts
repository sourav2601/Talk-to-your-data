import alasql from "alasql";

// Initialize the in-memory Alasql table mapping
export function bindDatasetToTable(rawData: Record<string, any>[]): void {
  try {
    // If the table already exists, recreate it or clean it up to ensure clean state
    if (alasql.tables.df) {
      delete alasql.tables.df;
    }
    
    alasql("CREATE TABLE df");
    alasql.tables.df.data = rawData;
  } catch (err: any) {
    console.error("Failed to bind dataset to alasql table:", err);
    throw new Error("Unable to load data into query engine: " + err.message);
  }
}

export function executeSqlQuery(sql: string): Record<string, any>[] {
  try {
    // Standardize query (alasql executes best with clean spacing and matching semicolon rules)
    let cleanSql = sql.trim();
    if (cleanSql.endsWith(";")) {
      cleanSql = cleanSql.slice(0, -1);
    }

    const results = alasql(cleanSql);
    
    if (!results) {
      return [];
    }

    if (Array.isArray(results)) {
      return results as Record<string, any>[];
    }

    return [results]; // fallback for single scalar values if returned directly
  } catch (err: any) {
    console.error("Alasql execution failed for query:", sql, err);
    throw new Error(err.message || "SQL Syntax Error");
  }
}

// Help auto-determine optimal visualization type based on SQL columns and result counts
export function detectChartType(
  columns: string[],
  rows: Record<string, any>[],
  originalQuestion: string,
  sql: string
): "bar" | "line" | "pie" | "scatter" | "none" {
  if (rows.length === 0 || columns.length < 2) {
    return "none";
  }

  const q = originalQuestion.toLowerCase();
  const s = sql.toLowerCase();

  // 1. Scatter Chart detection
  const numericColumns = columns.filter((col) => {
    const val = rows[0][col];
    return typeof val === "number";
  });

  if (numericColumns.length >= 2 && (q.includes("scatter") || q.includes("relationship") || q.includes("correlation"))) {
    return "scatter";
  }

  // 2. Time Series / Line Chart detection
  const hasDateOrTimeColumn = columns.some((col) => {
    const lowCol = col.toLowerCase();
    return (
      lowCol.includes("date") ||
      lowCol.includes("year") ||
      lowCol.includes("month") ||
      lowCol.includes("day") ||
      lowCol.includes("quarter") ||
      lowCol.includes("time") ||
      lowCol.includes("trend")
    );
  });

  if (hasDateOrTimeColumn && (q.includes("trend") || q.includes("over time") || q.includes("by year") || q.includes("by month") || q.includes("evolution") || s.includes("order by"))) {
    return "line";
  }

  // 3. Proportion / Pie Chart detection
  const isProportion = q.includes("percentage") || q.includes("proportion") || q.includes("share") || q.includes("pie") || q.includes("breakdown");
  if (isProportion && rows.length <= 8) {
    return "pie";
  }

  // 4. Default Aggregation / Bar Chart
  if (rows.length > 0 && columns.length >= 2) {
    return "bar";
  }

  return "none";
}
