import * as XLSX from "xlsx";
import { DatasetInfo, ColumnSchema } from "../types";

export function parseSpreadsheetFile(file: File): Promise<DatasetInfo> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, {
          type: "array",
          cellDates: true, // Auto-parse dates if SheetJS recognizes them
        });

        if (workbook.SheetNames.length === 0) {
          throw new Error("The Excel/CSV workbook is empty.");
        }

        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];

        // Parse to raw array of row objects
        const rawJson = XLSX.utils.sheet_to_json<Record<string, any>>(worksheet, {
          defval: null, // Ensure blank cells represent null rather than being omitted
        });

        if (rawJson.length === 0) {
          throw new Error("No data rows found in the active worksheet.");
        }

        // Extract all column names across all rows
        const columnNamesSet = new Set<string>();
        rawJson.forEach((row) => {
          Object.keys(row).forEach((key) => columnNamesSet.add(key));
        });
        const columnNames = Array.from(columnNamesSet);

        // Infer types and statistics for each column
        const columns: ColumnSchema[] = columnNames.map((colName) => {
          const nonNullValues = rawJson
            .map((row) => row[colName])
            .filter((v) => v !== null && v !== undefined && v !== "");

          const nullCount = rawJson.length - nonNullValues.length;
          const uniqueCount = new Set(nonNullValues).size;

          // Type Inference
          let type: "number" | "string" | "date" | "boolean" = "string";

          if (nonNullValues.length > 0) {
            // Check if values are mostly numeric
            const numericMatches = nonNullValues.filter((v) => {
              if (typeof v === "number") return true;
              if (typeof v === "string") {
                const trimmed = v.trim();
                return trimmed !== "" && !isNaN(Number(trimmed));
              }
              return false;
            });

            // Check if values are dates
            const dateMatches = nonNullValues.filter((v) => {
              if (v instanceof Date && !isNaN(v.getTime())) return true;
              if (typeof v === "string" && v.length >= 8) {
                const d = Date.parse(v);
                return !isNaN(d) && isNaN(Number(v)) && v.includes("-") || v.includes("/");
              }
              return false;
            });

            // Check if boolean
            const booleanMatches = nonNullValues.filter(
              (v) =>
                typeof v === "boolean" ||
                (typeof v === "string" &&
                  ["true", "false", "yes", "no"].includes(v.toLowerCase().trim()))
            );

            if (numericMatches.length / nonNullValues.length > 0.8) {
              type = "number";
            } else if (dateMatches.length / nonNullValues.length > 0.8) {
              type = "date";
            } else if (booleanMatches.length / nonNullValues.length > 0.8) {
              type = "boolean";
            }
          }

          // Gather unique sample values (up to 3 distinct values for prompt injection)
          const sampleValues = Array.from(new Set(nonNullValues)).slice(0, 3);

          return {
            name: colName,
            type,
            sampleValues,
            nullCount,
            uniqueCount,
          };
        });

        // Try normalizing dates and numbers so SQL handles queries correctly
        const normalizedData = rawJson.map((row) => {
          const newRow: Record<string, any> = {};
          columns.forEach((col) => {
            const val = row[col.name];
            if (val === null || val === undefined || val === "") {
              newRow[col.name] = null;
            } else if (col.type === "number") {
              const num = Number(val);
              newRow[col.name] = isNaN(num) ? val : num;
            } else if (col.type === "date") {
              if (val instanceof Date) {
                newRow[col.name] = val.toISOString().split("T")[0];
              } else {
                const parsedDate = new Date(val);
                newRow[col.name] = !isNaN(parsedDate.getTime())
                  ? parsedDate.toISOString().split("T")[0]
                  : String(val);
              }
            } else if (col.type === "boolean") {
              if (typeof val === "boolean") {
                newRow[col.name] = val;
              } else {
                const str = String(val).toLowerCase().trim();
                newRow[col.name] = ["true", "yes", "1"].includes(str);
              }
            } else {
              newRow[col.name] = String(val);
            }
          });
          return newRow;
        });

        resolve({
          fileName: file.name,
          fileSize: file.size,
          rowCount: normalizedData.length,
          columnsCount: columns.length,
          columns,
          rawData: normalizedData,
        });
      } catch (err: any) {
        reject(new Error("SheetJS failed to parse file: " + err.message));
      }
    };

    reader.onerror = () => {
      reject(new Error("File failed to read."));
    };

    reader.readAsArrayBuffer(file);
  });
}
