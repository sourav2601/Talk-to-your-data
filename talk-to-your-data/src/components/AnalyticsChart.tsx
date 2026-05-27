import React, { useState, useMemo } from "react";

interface AnalyticsChartProps {
  type: "bar" | "line" | "pie" | "scatter" | "none";
  data: Record<string, any>[];
  question: string;
}

export const AnalyticsChart: React.FC<AnalyticsChartProps> = ({ type, data, question }) => {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  // If there's no data or we can't show a chart, render nothing.
  if (!data || data.length === 0 || type === "none") {
    return null;
  }

  // Auto-detect best columns for rendering
  const { xKey, yKey, labelKey } = useMemo(() => {
    const keys = Object.keys(data[0] || {});
    const numericKeys = keys.filter((k) => typeof data[0][k] === "number");
    const nonNumericKeys = keys.filter((k) => typeof data[0][k] !== "number");

    // X axis (independent/labels) is usually the first string or date column
    const xKey = nonNumericKeys[0] || keys[0];
    
    // Y axis (dependent/quantitative) is usually the first numeric column
    const yKey = numericKeys[0] || keys[1] || keys[0];

    return {
      xKey,
      yKey,
      labelKey: xKey,
    };
  }, [data]);

  const chartTitle = useMemo(() => {
    return `${String(yKey).replace(/_/g, " ")} by ${String(xKey).replace(/_/g, " ")}`;
  }, [xKey, yKey]);

  // Transform data elements safely into visual tuples
  const chartPoints = useMemo(() => {
    return data.map((row) => {
      const xVal = row[xKey];
      const yVal = Number(row[yKey]) || 0;
      return {
        label: xVal !== null && xVal !== undefined ? String(xVal) : "Null / Blank",
        value: yVal,
        raw: row,
      };
    });
  }, [data, xKey, yKey]);

  const maxVal = useMemo(() => {
    const values = chartPoints.map((p) => p.value);
    const max = Math.max(...values, 0);
    return max === 0 ? 100 : max; // fallback to avoid division by 0
  }, [chartPoints]);

  const sumVal = useMemo(() => {
    return chartPoints.reduce((acc, p) => acc + p.value, 0);
  }, [chartPoints]);

  // Color Palette - beautiful premium slate/indigo gradients
  const colors = [
    "#6366f1", // indigo-500
    "#3b82f6", // blue-500
    "#06b6d4", // cyan-500
    "#14b8a6", // teal-500
    "#10b981", // emerald-500
    "#84cc16", // lime-500
    "#eab308", // yellow-500
    "#f97316", // orange-500
    "#ef4444", // red-500
    "#a855f7", // purple-500
  ];

  // Limit rendering elements to the top 15 points to keep charts tidy and readable
  const displayPoints = useMemo(() => {
    return chartPoints.slice(0, 15);
  }, [chartPoints]);

  // Render horizontal Bar Chart
  const renderBarChart = () => {
    return (
      <div className="space-y-3.5">
        {displayPoints.map((point, idx) => {
          const pct = Math.min((point.value / maxVal) * 100, 100);
          const barColor = colors[idx % colors.length];

          return (
            <div
              key={idx}
              className="group flex flex-col sm:flex-row sm:items-center justify-between text-xs transition duration-200"
              onMouseEnter={() => setHoveredIndex(idx)}
              onMouseLeave={() => setHoveredIndex(null)}
            >
              <div className="w-full sm:w-1/4 pr-4 font-medium truncate text-gray-300" title={point.label}>
                {point.label}
              </div>
              <div className="w-full sm:w-3/4 flex items-center gap-3">
                <div className="grow bg-slate-800/80 rounded-full h-6 overflow-hidden relative border border-slate-700/60">
                  <div
                    className="h-full rounded-full transition-all duration-1000 ease-out"
                    style={{
                      width: `${pct}%`,
                      backgroundColor: barColor,
                      boxShadow: `0 0 12px ${barColor}40`,
                    }}
                  />
                  {hoveredIndex === idx && (
                    <div className="absolute inset-0 bg-white/5 pointer-events-none transition-opacity duration-200" />
                  )}
                </div>
                <div className="w-20 text-right font-mono font-bold text-gray-200">
                  {point.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  // Render Line Chart (Trend)
  const renderLineChart = () => {
    const width = 600;
    const height = 180;
    const padding = 30;

    const chartWidth = width - padding * 2;
    const chartHeight = height - padding * 2;

    const count = displayPoints.length;
    const points = displayPoints.map((point, idx) => {
      const x = padding + (idx / Math.max(count - 1, 1)) * chartWidth;
      const y = padding + chartHeight - (point.value / maxVal) * chartHeight;
      return { x, y, label: point.label, value: point.value };
    });

    // Build SVG path
    let pathD = "";
    if (points.length > 0) {
      pathD = `M ${points[0].x} ${points[0].y}`;
      for (let i = 1; i < points.length; i++) {
        // smooth bezier interpolation
        const cpX1 = points[i - 1].x + (points[i].x - points[i - 1].x) / 2;
        const cpY1 = points[i - 1].y;
        const cpX2 = points[i - 1].x + (points[i].x - points[i - 1].x) / 2;
        const cpY2 = points[i].y;
        pathD += ` C ${cpX1} ${cpY1}, ${cpX2} ${cpY2}, ${points[i].x} ${points[i].y}`;
      }
    }

    const areaD = points.length > 0
      ? `${pathD} L ${points[points.length - 1].x} ${height - padding} L ${points[0].x} ${height - padding} Z`
      : "";

    return (
      <div className="space-y-3">
        <div className="relative overflow-visible">
          <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto overflow-visible select-none">
            {/* Grid Lines */}
            <line x1={padding} y1={padding} x2={width - padding} y2={padding} stroke="#334155" strokeDasharray="3,3" />
            <line x1={padding} y1={padding + chartHeight / 2} x2={width - padding} y2={padding + chartHeight / 2} stroke="#334155" strokeDasharray="3,3" />
            <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="#475569" />

            {/* Area Fill */}
            {points.length > 0 && (
              <path
                d={areaD}
                fill="url(#line-gradient-area)"
                className="transition-all duration-1000 ease-out"
              />
            )}

            {/* Line Path */}
            {points.length > 0 && (
              <path
                d={pathD}
                fill="none"
                stroke="#6366f1"
                strokeWidth="3.5"
                strokeLinecap="round"
                className="transition-all duration-1000 ease-out"
              />
            )}

            {/* Points Plot */}
            {points.map((p, idx) => (
              <g
                key={idx}
                onMouseEnter={() => setHoveredIndex(idx)}
                onMouseLeave={() => setHoveredIndex(null)}
                className="cursor-pointer"
              >
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={hoveredIndex === idx ? 7 : 4}
                  fill={hoveredIndex === idx ? "#818cf8" : "#6366f1"}
                  stroke="#1e293b"
                  strokeWidth="2.5"
                  className="transition-all duration-150"
                />
              </g>
            ))}

            <defs>
              <linearGradient id="line-gradient-area" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#6366f1" stopOpacity="0.4" />
                <stop offset="100%" stopColor="#6366f1" stopOpacity="0.0" />
              </linearGradient>
            </defs>
          </svg>

          {/* Inline Tooltip Overlay */}
          <div className="h-6 flex items-center justify-between font-mono text-xs text-gray-400 border-t border-slate-800 pt-2 shrink-0">
            <div>
              {hoveredIndex !== null
                ? `📅 ${points[hoveredIndex].label}`
                : `💡 Hover points to track coordinates`}
            </div>
            <div className="font-bold text-indigo-400">
              {hoveredIndex !== null
                ? `📈 ${points[hoveredIndex].value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
                : ""}
            </div>
          </div>
        </div>
      </div>
    );
  };

  // Render Pie / Donut Chart
  const renderPieChart = () => {
    const size = 200;
    const center = size / 2;
    const radius = 80;
    const innerRadius = 50; // Donut cut

    // Compute cumulative percentages and coordinates
    let accumulatedAngle = -90; // Start at top 12 o'clock

    const slices = displayPoints.map((slice, idx) => {
      const percentage = (slice.value / (sumVal || 1)) * 100;
      const angle = (slice.value / (sumVal || 1)) * 360;

      const startAngle = accumulatedAngle;
      const endAngle = accumulatedAngle + angle;
      accumulatedAngle = endAngle;

      // Coordinate helper
      const polarToCartesian = (centerX: number, centerY: number, rad: number, angleInDegrees: number) => {
        const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180.0;
        return {
          x: centerX + rad * Math.cos(angleInRadians),
          y: centerY + rad * Math.sin(angleInRadians),
        };
      };

      const startArc = polarToCartesian(center, center, radius, startAngle);
      const endArc = polarToCartesian(center, center, radius, endAngle);
      const startInner = polarToCartesian(center, center, innerRadius, endAngle);
      const endInner = polarToCartesian(center, center, innerRadius, startAngle);

      const largeArcFlag = angle > 180 ? 1 : 0;

      // Building donut path segment:
      // M: outer-start -> A: outer-arc-clockwise -> L: inner-end -> A: inner-arc-counter-clockwise -> Z: close
      const d = `
        M ${startArc.x} ${startArc.y}
        A ${radius} ${radius} 0 ${largeArcFlag} 1 ${endArc.x} ${endArc.y}
        L ${startInner.x} ${startInner.y}
        A ${innerRadius} ${innerRadius} 0 ${largeArcFlag} 0 ${endInner.x} ${endInner.y}
        Z
      `;

      return {
        path: d,
        label: slice.label,
        value: slice.value,
        percentage,
        color: colors[idx % colors.length],
      };
    });

    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 items-center">
        {/* SVG Circle Segments */}
        <div className="flex justify-center relative">
          <svg viewBox={`0 0 ${size} ${size}`} className="w-48 h-48 select-none overflow-visible">
            {slices.map((slice, idx) => {
              const active = hoveredIndex === idx;
              return (
                <path
                  key={idx}
                  d={slice.path}
                  fill={slice.color}
                  onMouseEnter={() => setHoveredIndex(idx)}
                  onMouseLeave={() => setHoveredIndex(null)}
                  className="transition-all duration-150 cursor-pointer origin-center"
                  style={{
                    transform: active ? "scale(1.05)" : "scale(1.0)",
                    filter: active ? `drop-shadow(0 0 8px ${slice.color}60)` : "none",
                  }}
                />
              );
            })}
          </svg>

          {/* Centered Total inside Donut */}
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <span className="text-gray-400 text-[10px] uppercase tracking-widest font-mono">Total Sum</span>
            <span className="text-sm font-bold text-gray-100 font-mono">
              {sumVal.toLocaleString(undefined, { maximumFractionDigits: 1 })}
            </span>
          </div>
        </div>

        {/* Legend Panel */}
        <div className="space-y-1.5 max-h-48 overflow-y-auto custom-scrollbar pr-2">
          {slices.map((slice, idx) => (
            <div
              key={idx}
              className={`flex items-center justify-between text-xs p-1.5 rounded-lg transition-colors duration-150 cursor-pointer ${
                hoveredIndex === idx ? "bg-slate-800/80 text-white" : "text-gray-300 hover:bg-slate-800/40"
              }`}
              onMouseEnter={() => setHoveredIndex(idx)}
              onMouseLeave={() => setHoveredIndex(null)}
            >
              <div className="flex items-center gap-2 truncate pr-2">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: slice.color }} />
                <span className="font-medium truncate" title={slice.label}>
                  {slice.label}
                </span>
              </div>
              <div className="font-mono text-gray-400 select-all font-semibold shrink-0">
                {slice.percentage.toFixed(1)}% ({slice.value.toLocaleString(undefined, { maximumFractionDigits: 1 })})
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  // Render Scatter Plot
  const renderScatterPlot = () => {
    const width = 600;
    const height = 180;
    const padding = 34;

    const chartWidth = width - padding * 2;
    const chartHeight = height - padding * 2;

    return (
      <div className="space-y-3">
        <div className="relative overflow-visible">
          <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto overflow-visible select-none">
            {/* Grid layout */}
            <line x1={padding} y1={padding} x2={width - padding} y2={padding} stroke="#334155" strokeDasharray="3,3" />
            <line x1={padding} y1={padding + chartHeight / 2} x2={width - padding} y2={padding + chartHeight / 2} stroke="#334155" strokeDasharray="3,3" />
            <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="#475569" />
            <line x1={padding} y1={padding} x2={padding} y2={height - padding} stroke="#475569" />

            {/* Scatter dots */}
            {displayPoints.map((point, idx) => {
              // Standard pseudo coordinates mapping
              const xPos = padding + (idx / Math.max(displayPoints.length - 1, 1)) * chartWidth;
              const yPos = padding + chartHeight - (point.value / maxVal) * chartHeight;
              const dotColor = colors[idx % colors.length];

              return (
                <g
                  key={idx}
                  onMouseEnter={() => setHoveredIndex(idx)}
                  onMouseLeave={() => setHoveredIndex(null)}
                  className="cursor-pointer"
                >
                  <circle
                    cx={xPos}
                    cy={yPos}
                    r={hoveredIndex === idx ? 8 : 5.5}
                    fill={dotColor}
                    stroke="#1e293b"
                    strokeWidth="1.5"
                    className="transition-all duration-150"
                  />
                </g>
              );
            })}
          </svg>
          <div className="h-6 flex items-center justify-between font-mono text-xs text-gray-400 border-t border-slate-800 pt-2 shrink-0">
            <div>
              {hoveredIndex !== null
                ? `🎯 ${displayPoints[hoveredIndex].label}`
                : `💡 Scatter Correlation Plot`}
            </div>
            <div className="font-bold text-indigo-400">
              {hoveredIndex !== null
                ? `Value: ${displayPoints[hoveredIndex].value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
                : ""}
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="bg-slate-900/40 rounded-xl p-4 sm:p-5 border border-slate-800/80 shadow-md">
      <div className="flex items-center justify-between mb-4 border-b border-indigo-500/10 pb-2 bg-gradient-to-r from-transparent to-indigo-500/10 rounded-sm">
        <h4 className="text-xs font-bold uppercase tracking-wider text-indigo-400 font-sans">
          📊 Visual Analytics Chart
        </h4>
        <span className="text-[10px] font-mono text-slate-500 italic">
          {chartTitle}
        </span>
      </div>

      <div>
        {type === "bar" && renderBarChart()}
        {type === "line" && renderLineChart()}
        {type === "pie" && renderPieChart()}
        {type === "scatter" && renderScatterPlot()}
      </div>
    </div>
  );
};
