/**
 * GridPulse — Voltage Monitor Dashboard
 * React frontend that matches the screenshots exactly.
 *
 * Connects to Django backend at http://localhost:8000/api/
 * Uses recharts for all charts (line chart + bar chart).
 *
 * Features:
 *  - 5 KPI stat cards (avg voltage, min/max, healthy buses, warnings, critical)
 *  - Zone filter dropdown
 *  - Chart type toggle (Line / Area / Band)
 *  - Operating Limits toggle
 *  - Smart Buses Only toggle
 *  - Bus legend with color-coded pills
 *  - 24h line chart with hourly resolution + interactive tooltip
 *  - Time scrubber slider (t = 0 to 95)
 *  - Voltage Snapshot bar chart at selected timestep
 *  - Bus Status panel (right sidebar)
 *  - Live indicator + Refresh button + Dark mode toggle
 */

import { useState, useEffect, useCallback, useRef } from "react";
import {
  LineChart, Line, AreaChart, Area,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, ResponsiveContainer, Legend
} from "recharts";

// ─── API Base URL ─────────────────────────────────────────────────────────────
// Use relative /api path so Vite proxy or same-origin deployment works cleanly.
const API = "/api";

// ─── Bus Colors (matching screenshot palette) ─────────────────────────────────
const BUS_COLORS = [
  "#38bdf8", // Bus 0 — sky blue
  "#34d399", // Bus 1 — emerald
  "#a78bfa", // Bus 2 — purple
  "#fb923c", // Bus 3 — orange
  "#f43f5e", // Bus 4 — rose/red
  "#facc15", // Bus 5 — yellow
  "#c084fc", // Bus 6 — violet
  "#94a3b8", // Bus 7 — slate
];

// ─── Status Colors ────────────────────────────────────────────────────────────
const STATUS_COLOR = {
  NORMAL:   "#34d399",  // green
  WARNING:  "#fb923c",  // orange
  CRITICAL: "#f43f5e",  // red
};

// ─── Voltage operating limits ─────────────────────────────────────────────────
const LIMIT_NORMAL_LOW  = 0.98;
const LIMIT_NORMAL_HIGH = 1.02;

const LIMIT_CRITICAL_LOW  = 0.95;
const LIMIT_CRITICAL_HIGH = 1.05;

// ─── Main App Component ───────────────────────────────────────────────────────
export default function GridPulseDashboard() {
  // ── State ──────────────────────────────────────────────────────────────────
  const [dark, setDark]             = useState(false);      // dark/light mode
  const [buses, setBuses]           = useState([]);          // bus metadata from /api/buses/
  const [simData, setSimData]       = useState(null);        // simulation time-series
  const [summary, setSummary]       = useState(null);        // KPI summary
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(null);
  const [isMobile, setIsMobile]     = useState(false);

  // Chart controls
  const [zone, setZone]             = useState("All Zones");
  const [chartType, setChartType]   = useState("Line");      // Line / Area / Band
  const [showLimits, setShowLimits] = useState(true);        // show reference lines
  const [smartOnly, setSmartOnly]   = useState(false);       // filter Smart buses only
  const [activeBuses, setActiveBuses] = useState(new Set()); // which buses are visible
  const [timeStep, setTimeStep]     = useState(12);          // slider position (0–23, 12=12:00)
  const [liveMode, setLiveMode]     = useState(true);

  const DATE = "2026-04-16";
  const refreshInterval = useRef(null);

  // ── Fetch all data ─────────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    try {
      setLoading(true);

      // 1. Fetch bus metadata
      const busRes  = await fetch(`${API}/buses/`);
      if (!busRes.ok) {
        const text = await busRes.text();
        throw new Error(`Buses API failed: ${busRes.status} ${busRes.statusText} - ${text || 'no response body'}`);
      }
      const busJson = await busRes.json();
      setBuses(busJson);

      // Initialize all buses as active
      setActiveBuses(new Set(busJson.map(b => b.bus_id)));

      // 2. Fetch simulation time-series
      const simRes  = await fetch(`${API}/simulation/?date=${DATE}`);
      if (!simRes.ok) {
        const text = await simRes.text();
        throw new Error(`Simulation API failed: ${simRes.status} ${simRes.statusText} - ${text || 'no response body'}`);
      }
      const simJson = await simRes.json();
      setSimData(simJson);

      // 3. Fetch dashboard summary at current timestep
      const ts = simJson.timestamps?.[timeStep] || "12:00";
      const sumRes  = await fetch(`${API}/dashboard-summary/?timestamp=${DATE}T${ts}:00`);
      if (!sumRes.ok) {
        const text = await sumRes.text();
        throw new Error(`Summary API failed: ${sumRes.status} ${sumRes.statusText} - ${text || 'no response body'}`);
      }
      const sumJson = await sumRes.json();
      setSummary(sumJson);

      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [timeStep]);

  useEffect(() => {
    fetchData();
  }, []);

  // Live refresh every 30 seconds if liveMode is on
  useEffect(() => {
    if (liveMode) {
      refreshInterval.current = setInterval(fetchData, 30000);
    }
    return () => clearInterval(refreshInterval.current);
  }, [liveMode, fetchData]);

  // Track mobile viewport for responsive layout adjustments
  useEffect(() => {
    const updateMobile = () => setIsMobile(window.innerWidth < 900);
    updateMobile();
    window.addEventListener('resize', updateMobile);
    return () => window.removeEventListener('resize', updateMobile);
  }, []);

  // // Update summary when timeslider changes
  // useEffect(() => {
  //   if (!simData) return;
  //   const ts = simData.timestamps?.[timeStep];
  //   if (!ts) return;
  //   console.log(ts);
  //   fetch(`${API}/dashboard-summary/?timestamp=${DATE}T${ts}:00`)
  //     .then(r => r.json())
  //     .then(setSummary)
  //     .catch(() => {});
  // }, [timeStep, simData]);

  // ── Derived: filter buses by zone and smart-only ───────────────────────────
  const visibleBuses = buses.filter(b => {
    if (zone !== "All Zones" && b.zone !== zone) return false;
    if (smartOnly && b.bus_type !== "Smart") return false;
    return true;
  });

  // ── Build chart data: array of { time, bus0, bus1, ... } ──────────────────
  const chartData = (() => {
    if (!simData) return [];
    return simData.timestamps.map((ts, i) => {
      const point = { time: ts };
      simData.buses.forEach(b => {
        point[`bus${b.bus_id}`] = b.voltages[i];
      });
      return point;
    });
  })();

  // ── Snapshot data for bar chart (at selected timestep) ────────────────────
  const snapshotData = (() => {
    if (!simData) return [];
    return simData.buses.map(b => ({
      name: `B${b.bus_id + 1}`,
      bus_id: b.bus_id,
      vm_pu: b.voltages[timeStep],
      status: b.statuses[timeStep],
    }));
  })();

  const snapshotTime = simData?.timestamps?.[timeStep] || "12:00";

  // ── Derive live KPI summary from the selected snapshot so counts update immediately
  const snapshotSummary = (() => {
    if (!snapshotData.length) return null;
    const voltages = snapshotData.map(entry => entry.vm_pu);
    const statuses = snapshotData.map(entry => entry.status);
    const total = voltages.length;
    const avg = total > 0 ? voltages.reduce((sum, v) => sum + v, 0) / total : 0;

    return {
      avg_voltage: Number(avg.toFixed(3)),
      min_voltage: Number(Math.min(...voltages).toFixed(3)),
      max_voltage: Number(Math.max(...voltages).toFixed(3)),
      healthy_count: statuses.filter(s => s === "NORMAL").length,
      warning_count: statuses.filter(s => s === "WARNING").length,
      critical_count: statuses.filter(s => s === "CRITICAL").length,
      total_buses: total,
      snapshot_time: snapshotTime,
    };
  })();

  const currentSummary = snapshotSummary || summary;

  // ── Toggle a bus on/off in the legend ─────────────────────────────────────
  const toggleBus = (bus_id) => {
    setActiveBuses(prev => {
      const next = new Set(prev);
      if (next.has(bus_id)) next.delete(bus_id);
      else next.add(bus_id);
      return next;
    });
  };

  // ── Theme ──────────────────────────────────────────────────────────────────
  const bg      = dark ? "#0f172a" : "#f8fafc";
  const card    = dark ? "#1e293b" : "#ffffff";
  const border  = dark ? "#334155" : "#e2e8f0";
  const text    = dark ? "#f1f5f9" : "#1e293b";
  const subtext = dark ? "#94a3b8" : "#64748b";
  const gridCol = dark ? "#1e293b" : "#f1f5f9";
  const cardShadow = dark ? "0 28px 75px rgba(15,23,42,0.20)" : "0 18px 40px rgba(15,23,42,0.08)";
  const heroBg = dark ? "#111827" : "rgba(255,255,255,0.92)";

  // ── Custom Tooltip for line chart ──────────────────────────────────────────
  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    return (
      <div style={{
        background: card, border: `1px solid ${border}`,
        borderRadius: 12, padding: "12px 16px",
        boxShadow: "0 8px 32px rgba(0,0,0,0.12)"
      }}>
        <div style={{ fontWeight: 700, color: text, marginBottom: 8, fontFamily: "monospace" }}>
          t = {label}
        </div>
        {payload.map((p, i) => {
          const busId = parseInt(p.dataKey.replace("bus", ""));
          const busInfo = buses.find(b => b.bus_id === busId);
          const vm = p.value?.toFixed(4);
          let statusColor = STATUS_COLOR.NORMAL;
          let statusLabel = "NORMAL";
          if (p.value < LIMIT_CRITICAL_LOW || p.value > LIMIT_CRITICAL_HIGH) {
            statusColor = STATUS_COLOR.CRITICAL; statusLabel = "CRITICAL";
          } else if (p.value < LIMIT_NORMAL_LOW || p.value > LIMIT_NORMAL_HIGH) {
            statusColor = STATUS_COLOR.WARNING; statusLabel = "WARNING";
          }
          return (
            <div key={i} style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 4 }}>
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: p.color }} />
              <span style={{ color: subtext, fontSize: 13, minWidth: 60 }}>
                {busInfo?.bus_name || p.dataKey}
              </span>
              <span style={{ color: text, fontWeight: 600, fontSize: 13, fontFamily: "monospace" }}>
                {vm}
              </span>
              <span style={{ color: statusColor, fontWeight: 700, fontSize: 11 }}>
                {statusLabel}
              </span>
            </div>
          );
        })}
      </div>
    );
  };

  // ─── Render ────────────────────────────────────────────────────────────────
  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center",
      height: "100vh", background: bg, color: text, fontFamily: "sans-serif", gap: 12 }}>
      <div style={{ width: 20, height: 20, border: "3px solid #38bdf8",
        borderTopColor: "transparent", borderRadius: "50%",
        animation: "spin 0.8s linear infinite" }} />
      Loading GridPulse data...
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );

  if (error) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center",
      height: "100vh", background: bg, color: "#f43f5e", fontFamily: "sans-serif",
      flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 20, fontWeight: 700 }}>⚠ Error loading data</div>
      <div style={{ color: subtext, maxWidth: 500, textAlign: "center" }}>{error}</div>
      <div style={{ background: "#1e293b", color: "#94a3b8", padding: "12px 20px",
        borderRadius: 8, fontFamily: "monospace", fontSize: 13, marginTop: 8 }}>
        curl -X POST "http://localhost:8001/api/run-simulation/?date=2026-04-16"
      </div>
      <button onClick={fetchData} style={{ marginTop: 12, padding: "8px 20px",
        background: "#38bdf8", color: "#000", border: "none", borderRadius: 8,
        cursor: "pointer", fontWeight: 600 }}>Retry</button>
    </div>
  );

  const contentPadding = isMobile ? "14px 16px" : "24px 32px";
  const headerLayout = isMobile ? { flexWrap: "wrap", justifyContent: "center", gap: 10 } : { justifyContent: "space-between" };
  const statGridColumns = isMobile ? "repeat(1, 1fr)" : "repeat(5, minmax(0, 1fr))";
  const snapshotLayout = isMobile ? "1fr" : "1fr 340px";
  const chartHeight = isMobile ? 220 : 320;

  return (
    <div style={{ minHeight: "100vh", background: bg, color: text,
      fontFamily: "'DM Sans', system-ui, sans-serif", transition: "all 0.3s" }}>
      <style>{`
        .stat-card:hover { transform: translateY(-6px); }
        button { transition: transform 0.2s ease, box-shadow 0.2s ease; }
        button:hover { transform: translateY(-1px); box-shadow: 0 15px 35px rgba(15,23,42,0.08); }
        .legend-pill:hover { transform: translateY(-1px); }
        .legend-pill { transition: transform 0.2s ease; }
        .live-pill { cursor: pointer; transition: transform 0.2s ease, box-shadow 0.2s ease; }
        .live-pill:hover { transform: translateY(-1px); box-shadow: 0 12px 28px rgba(15,23,42,0.08); }
      `}</style>

      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "center", 
        padding: "14px 16px", borderBottom: `1px solid ${border}`,
        background: card, position: "sticky", top: 0, zIndex: 100, ...headerLayout }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {/* Logo */}
          <div style={{ width: 38, height: 38, background: "#0ea5e9",
            borderRadius: 10, display: "flex", alignItems: "center",
            justifyContent: "center", fontSize: 18 }}>⚡</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, letterSpacing: "-0.3px" }}>
              GridPulse — 1Voltage Monitor
            </div>
            <div style={{ color: subtext, fontSize: 12 }}>
              Power System Network Management
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {/* Live indicator */}
          <div className="live-pill" onClick={() => setLiveMode(!liveMode)}
            style={{ display: "flex", alignItems: "center", gap: 6,
              padding: "5px 12px", borderRadius: 20,
              background: liveMode ? "#dcfce7" : "#f1f5f9",
              border: `1px solid ${liveMode ? "#86efac" : border}` }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%",
              background: liveMode ? "#22c55e" : "#94a3b8",
              animation: liveMode ? "pulse 1.5s infinite" : "none" }} />
            <span style={{ fontSize: 13, fontWeight: 600,
              color: liveMode ? "#15803d" : subtext }}>
              {liveMode ? "Live" : "Paused"}
            </span>
          </div>
          {/* Refresh */}
          <button onClick={fetchData}
            style={{ display: "flex", alignItems: "center", gap: 6,
              padding: "5px 14px", background: "transparent",
              border: `1px solid ${border}`, borderRadius: 8,
              cursor: "pointer", color: text, fontSize: 13 }}>
            ↻ Refresh
          </button>
          {/* Dark mode */}
          <button onClick={() => setDark(!dark)}
            style={{ width: 34, height: 34, borderRadius: 8,
              border: `1px solid ${border}`, background: "transparent",
              cursor: "pointer", fontSize: 16, color: text }}>
            {dark ? "☀" : "🌙"}
          </button>
        </div>
      </div>

      <div style={{ padding: contentPadding, width: "100%", margin: "0 auto" }}>

        {/* ── Hero Panel ── */}
        <div style={{ background: heroBg, border: `1px solid ${border}`, borderRadius: 24,
          padding: isMobile ? "22px 18px" : "28px 30px", marginBottom: 24,
          boxShadow: cardShadow, display: "flex", flexDirection: isMobile ? "column" : "row",
          justifyContent: "space-between", alignItems: isMobile ? "flex-start" : "center", gap: 16 }}>
          <div style={{ maxWidth: isMobile ? "100%" : 760 }}>
            <div style={{ fontSize: isMobile ? 24 : 30, fontWeight: 800, color: text, lineHeight: 1.05 }}>
              Voltage Monitoring
            </div>
            <div style={{ marginTop: 10, color: subtext, fontSize: 14, maxWidth: 720, lineHeight: 1.7 }}>
              Track voltage health, smart meter performance and bus stability across the network with a clean, responsive dashboard.
              Use the snapshot slider, status summary and interactive chart controls to explore real-time behavior.
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div style={{ padding: "10px 16px", borderRadius: 999, background: "#dcfce7", color: "#166534", fontWeight: 700, fontSize: 12 }}>
              {liveMode ? "Live updates enabled" : "Live updates paused"}
            </div>
            <div style={{ padding: "10px 16px", borderRadius: 999, background: "#e0f2fe", color: "#075985", fontWeight: 700, fontSize: 12 }}>
              Snapshot @ {snapshotTime}
            </div>
          </div>
        </div>

        {/* ── KPI Stat Cards ── */}
        <div style={{ display: "grid", gridTemplateColumns: statGridColumns,
          gap: 16, marginBottom: 24 }}>

          {/* Avg Voltage */}
          <StatCard dark={dark} card={card} border={border} text={text} subtext={subtext}
             label="AVG VOLTAGE"
            value={currentSummary ? `${currentSummary.avg_voltage} pu` : "—"}
            sub={`@ ${snapshotTime}`} iconColor="#0ea5e9" />

          {/* Min/Max */}
          <StatCard dark={dark} card={card} border={border} text={text} subtext={subtext}
             label="MIN / MAX"
            value={currentSummary ? `${currentSummary.min_voltage} / ${currentSummary.max_voltage}` : "—"}
            sub="per-unit range" iconColor="#06b6d4" />

          {/* Healthy Buses */}
          <StatCard dark={dark} card={card} border={border} text={text} subtext={subtext}
             label="HEALTHY BUSES"
            value={currentSummary ? currentSummary.healthy_count : "—"}
            sub={`of ${currentSummary?.total_buses || 8} total`} iconColor="#22c55e" />

          {/* Warnings */}
          <StatCard dark={dark} card={card} border={border} text={text} subtext={subtext}
             label="WARNINGS"
            value={currentSummary ? currentSummary.warning_count : "—"}
            sub={`${LIMIT_NORMAL_LOW} – ${LIMIT_NORMAL_HIGH} band`}
            iconColor="#f59e0b" />

          {/* Critical */}
          <StatCard dark={dark} card={card} border={border} text={text} subtext={subtext}
             label="CRITICAL"
            value={currentSummary ? currentSummary.critical_count : "—"}
            sub={`outside ±5%`} iconColor="#ef4444" />
        </div>

        {/* ── Chart Controls ── */}
        <div style={{ background: card, border: `1px solid ${border}`,
          borderRadius: 16, padding: "16px 20px", marginBottom: 4 }}>

          <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
            {/* Zone selector */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 12, color: subtext, fontWeight: 600 }}>⊞ ZONE</span>
              <select value={zone} onChange={e => setZone(e.target.value)}
                style={{ padding: "5px 10px", border: `1px solid ${border}`,
                  borderRadius: 8, background: card, color: text,
                  fontSize: 13, cursor: "pointer" }}>
                <option>All Zones</option>
                <option>Zone-N</option>
                <option>Zone-S</option>
              </select>
            </div>

            {/* Chart type */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 12, color: subtext, fontWeight: 600 }}>CHART</span>
              {['Line', 'Area', 'Band', 'Bar'].map(t => (
                <button key={t} onClick={() => setChartType(t)}
                  style={{ padding: "4px 12px", borderRadius: 20, border: "none",
                    cursor: "pointer", fontSize: 13, fontWeight: 500,
                    background: chartType === t ? text : "transparent",
                    color: chartType === t ? bg : subtext }}>
                  {t}
                </button>
              ))}
            </div>

            {/* Operating Limits toggle */}
            <Toggle label="Operating Limits" value={showLimits}
              onChange={setShowLimits} onColor="#3b82f6" />

            {/* Smart Buses Only toggle */}
            <Toggle label="Smart Buses Only" value={smartOnly}
              onChange={setSmartOnly} onColor="#3b82f6" />

            <div style={{ marginLeft: "auto", color: subtext, fontSize: 13 }}>
              {visibleBuses.filter(b => activeBuses.has(b.bus_id)).length} / {buses.length} buses plotted
            </div>
          </div>

          {/* Bus legend pills */}
          <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
            {buses.map(b => {
              const isVisible = visibleBuses.find(vb => vb.bus_id === b.bus_id);
              const isActive  = activeBuses.has(b.bus_id);
              return (
                <button key={b.bus_id} onClick={() => toggleBus(b.bus_id)}
                  style={{ display: "flex", alignItems: "center", gap: 6,
                    padding: "4px 12px", borderRadius: 20,
                    border: `1px solid ${isActive && isVisible ? BUS_COLORS[b.bus_id] : border}`,
                    background: isActive && isVisible ? `${BUS_COLORS[b.bus_id]}18` : "transparent",
                    cursor: "pointer", opacity: isVisible ? 1 : 0.35 }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%",
                    background: isActive && isVisible ? BUS_COLORS[b.bus_id] : border,
                    border: isActive && isVisible ? "none" : `2px solid ${border}` }} />
                  <span style={{ fontSize: 12, fontWeight: 500,
                    color: isActive && isVisible ? text : subtext }}>
                    Bus {b.bus_id} {b.kv}kV
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Main Line Chart ── */}
        <div style={{ background: card, border: `1px solid ${border}`,
          borderRadius: "0 0 16px 16px", borderTop: "none",
          padding: "20px 20px 10px", marginBottom: 16 }}>

          <div style={{ marginBottom: 16 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>
              Bus Voltage vs Time
            </div>
            <div style={{ color: subtext, fontSize: 12 }}>
              Per-unit voltage magnitudes from pandapower load-flow simulation
            </div>
          </div>

          <ResponsiveContainer width="100%" height={chartHeight}>
            {chartType === "Area" ? (
              <AreaChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridCol} />
                <XAxis dataKey="time" tick={{ fontSize: 11, fill: subtext }}
                  tickLine={false} interval={11} />
                <YAxis domain={[0.98, 1.035]} tick={{ fontSize: 11, fill: subtext }}
                  tickLine={false} axisLine={false} tickFormatter={v => v.toFixed(2)} />
                <Tooltip content={<CustomTooltip />} />
                {showLimits && <>
                  <ReferenceLine y={LIMIT_NORMAL_HIGH} stroke="#f59e0b" strokeDasharray="4 4" strokeWidth={1} />
                  <ReferenceLine y={LIMIT_NORMAL_LOW}  stroke="#f59e0b" strokeDasharray="4 4" strokeWidth={1} />
                  <ReferenceLine y={LIMIT_CRITICAL_HIGH} stroke="#ef4444" strokeDasharray="4 4" strokeWidth={1} />
                  <ReferenceLine y={LIMIT_CRITICAL_LOW}  stroke="#ef4444" strokeDasharray="4 4" strokeWidth={1} />
                </>}
                {visibleBuses.filter(b => activeBuses.has(b.bus_id)).map(b => (
                  <Area key={b.bus_id} type="monotone" dataKey={`bus${b.bus_id}`}
                    stroke={BUS_COLORS[b.bus_id]} fill={`${BUS_COLORS[b.bus_id]}20`}
                    strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                ))}
              </AreaChart>
            ) : chartType === "Bar" ? (
              <BarChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}
                barGap={2} barCategoryGap="20%">
                <CartesianGrid strokeDasharray="3 3" stroke={gridCol} />
                <XAxis dataKey="time" tick={{ fontSize: 11, fill: subtext }}
                  tickLine={false} interval={11} />
                <YAxis domain={[0.98, 1.035]} tick={{ fontSize: 11, fill: subtext }}
                  tickLine={false} axisLine={false} tickFormatter={v => v.toFixed(2)} />
                <Tooltip content={<CustomTooltip />} />
                <ReferenceLine x={simData?.timestamps?.[timeStep]}
                  stroke="#38bdf8" strokeWidth={1.5} strokeDasharray="4 4" />
                {showLimits && <>
                  <ReferenceLine y={LIMIT_NORMAL_HIGH} stroke="#f59e0b" strokeDasharray="4 4" strokeWidth={1} />
                  <ReferenceLine y={LIMIT_NORMAL_LOW}  stroke="#f59e0b" strokeDasharray="4 4" strokeWidth={1} />
                  <ReferenceLine y={LIMIT_CRITICAL_HIGH} stroke="#ef4444" strokeDasharray="4 4" strokeWidth={1} />
                  <ReferenceLine y={LIMIT_CRITICAL_LOW}  stroke="#ef4444" strokeDasharray="4 4" strokeWidth={1} />
                </>}
                {visibleBuses.filter(b => activeBuses.has(b.bus_id)).map(b => (
                  <Bar key={b.bus_id} dataKey={`bus${b.bus_id}`} fill={BUS_COLORS[b.bus_id]}
                    radius={[3, 3, 0, 0]} />
                ))}
              </BarChart>
            ) : (
              <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridCol} />
                <XAxis dataKey="time" tick={{ fontSize: 11, fill: subtext }}
                  tickLine={false} interval={11} />
                <YAxis domain={[0.98, 1.035]} tick={{ fontSize: 11, fill: subtext }}
                  tickLine={false} axisLine={false} tickFormatter={v => v.toFixed(2)} />
                <Tooltip content={<CustomTooltip />} />
                {/* Vertical line at current timeslider position */}
                <ReferenceLine x={simData?.timestamps?.[timeStep]}
                  stroke="#38bdf8" strokeWidth={1.5} strokeDasharray="4 4" />
                {showLimits && <>
                  <ReferenceLine y={LIMIT_NORMAL_HIGH} stroke="#f59e0b" strokeDasharray="4 4" strokeWidth={1} />
                  <ReferenceLine y={LIMIT_NORMAL_LOW}  stroke="#f59e0b" strokeDasharray="4 4" strokeWidth={1} />
                  <ReferenceLine y={LIMIT_CRITICAL_HIGH} stroke="#ef4444" strokeDasharray="4 4" strokeWidth={1} />
                  <ReferenceLine y={LIMIT_CRITICAL_LOW}  stroke="#ef4444" strokeDasharray="4 4" strokeWidth={1} />
                </>}
                {visibleBuses.filter(b => activeBuses.has(b.bus_id)).map(b => (
                  <Line key={b.bus_id} type="monotone" dataKey={`bus${b.bus_id}`}
                    stroke={BUS_COLORS[b.bus_id]} strokeWidth={2}
                    dot={false} activeDot={{ r: 4 }} />
                ))}
              </LineChart>
            )}
          </ResponsiveContainer>

          {/* ── Time Scrubber ── */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12 }}>
            <span style={{ fontSize: 12, color: subtext, minWidth: 40 }}>
              {simData?.timestamps?.[0] || "00:00"}
            </span>
            <input type="range" min={0} max={23} value={timeStep}
              onInput={e => setTimeStep(Number(e.target.value))}
              style={{ flex: 1, accentColor: "#0ea5e9", cursor: "pointer" }} />
            <span style={{ fontSize: 12, color: subtext, fontFamily: "monospace" }}>
              t = {timeStep} / 23
            </span>
          </div>
        </div>

        {/* ── Snapshot + Bus Status ── */}
        <div style={{ display: "grid", gridTemplateColumns: snapshotLayout, gap: 16 }}>

          {/* Bar chart snapshot */}
          <div style={{ background: card, border: `1px solid ${border}`,
            borderRadius: 16, padding: 20 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>
              Voltage Snapshot @ {snapshotTime}
            </div>
            <div style={{ color: subtext, fontSize: 12, marginBottom: 16 }}>
              Per-bus voltage at the selected time-step
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={snapshotData} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridCol} vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 12, fill: subtext }} tickLine={false} />
                <YAxis domain={[0.90, 1.10]} tick={{ fontSize: 11, fill: subtext }}
                  tickLine={false} axisLine={false} tickFormatter={v => v.toFixed(2)} />
                {showLimits && <>
                  <ReferenceLine y={LIMIT_NORMAL_HIGH} stroke="#f59e0b" strokeDasharray="4 4" strokeWidth={1} />
                  <ReferenceLine y={LIMIT_NORMAL_LOW}  stroke="#f59e0b" strokeDasharray="4 4" strokeWidth={1} />
                  <ReferenceLine y={1.0} stroke={subtext} strokeDasharray="2 4" strokeWidth={1} />
                </>}
                <Bar dataKey="vm_pu" radius={[4, 4, 0, 0]}
                  fill="#38bdf8"
                  // Color each bar by its status
                  label={false}>
                  {snapshotData.map((entry, i) => (
                    <rect key={i} fill={
                      entry.status === "CRITICAL" ? "#ef4444" :
                      entry.status === "WARNING"  ? "#f59e0b" : "#34d399"
                    } />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Bus Status sidebar */}
          <div style={{ background: card, border: `1px solid ${border}`,
            borderRadius: 16, padding: 20 }}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 16 }}>Bus Status</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2,
              maxHeight: 280, overflowY: "auto" }}>
              {snapshotData.map(b => {
                const busInfo = buses.find(bus => bus.bus_id === b.bus_id);
                return (
                  <div key={b.bus_id} style={{ display: "flex", alignItems: "center",
                    justifyContent: "space-between", padding: "10px 0",
                    borderBottom: `1px solid ${border}` }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ width: 8, height: 8, borderRadius: "50%",
                        background: STATUS_COLOR[b.status] }} />
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>
                          Bus {String(b.bus_id).padStart(2, "0")} — {busInfo?.bus_name}
                        </div>
                        <div style={{ fontSize: 11, color: subtext }}>
                          {busInfo?.zone} · {busInfo?.bus_type}
                        </div>
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontWeight: 700, fontSize: 14, fontFamily: "monospace" }}>
                        {b.vm_pu?.toFixed(3)}
                      </div>
                      <div style={{ fontSize: 11, fontWeight: 700,
                        color: STATUS_COLOR[b.status] }}>
                        {b.status}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: ${bg}; }
        input[type=range] { height: 4px; }
        select { outline: none; }
        button { outline: none; font-family: inherit; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-thumb { background: ${border}; border-radius: 4px; }
      `}</style>
    </div>
  );
}

// ─── StatCard Component ───────────────────────────────────────────────────────
function StatCard({ dark, card, border, text, subtext, icon, label, value, sub, iconColor }) {
  const cardShadow = dark ? "0 28px 75px rgba(15,23,42,0.20)" : "0 18px 40px rgba(15,23,42,0.08)";
  return (
    <div className="stat-card" style={{ background: card, border: `1px solid ${border}`,
      borderRadius: 16, padding: "18px 20px",
      display: "flex", alignItems: "flex-start", justifyContent: "space-between",
      boxShadow: cardShadow, transition: "transform 0.25s ease, box-shadow 0.25s ease" }}>
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: subtext,
          letterSpacing: "0.08em", marginBottom: 6 }}>{label}</div>
        <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.5px",
          color: text, fontFamily: "monospace" }}>{value}</div>
        <div style={{ fontSize: 12, color: subtext, marginTop: 4 }}>{sub}</div>
      </div>
      <div style={{ width: 36, height: 36, borderRadius: 10,
        background: `${iconColor}18`, display: "flex",
        alignItems: "center", justifyContent: "center",
        fontSize: 16, color: iconColor }}>
        {icon}
      </div>
    </div>
  );
}

// ─── Toggle Component ─────────────────────────────────────────────────────────
function Toggle({ label, value, onChange, onColor }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div onClick={() => onChange(!value)}
        style={{ width: 40, height: 22, borderRadius: 11, cursor: "pointer",
          background: value ? onColor : "#cbd5e1", position: "relative",
          transition: "background 0.2s" }}>
        <div style={{ width: 16, height: 16, borderRadius: "50%", background: "#fff",
          position: "absolute", top: 3,
          left: value ? 20 : 4, transition: "left 0.2s",
          boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }} />
      </div>
      <span style={{ fontSize: 13, fontWeight: 500, color: value ? "#1e293b" : "#94a3b8" }}>
        {label}
      </span>
    </div>
  );
}
