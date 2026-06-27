import React, { useState, useRef, useEffect } from 'react';
import { Terminal, Download, Trash2, Search, Filter, Cpu } from 'lucide-react';
import { TelemetryLog, FlightState } from '../types';

interface TelemetryTerminalProps {
  logs: TelemetryLog[];
  onClearLogs: () => void;
}

export interface TelemetryInsightsProps {
  logs: TelemetryLog[];
}

export function TelemetryInsights({ logs }: TelemetryInsightsProps) {
  const chartData = logs.slice(-15);

  // Generate SVG height ratios for charts
  const maxDbm = -30;
  const minDbm = -100;
  const getBatteryY = (pPercent: number) => {
    // scale 0-100% to height of 80px (flip since SVG is top-down, so 100% is near 10px, 0% is near 90px)
    return 90 - (pPercent / 100) * 80;
  };

  const getSignalY = (dbm: number) => {
    // scale -30 to -100 to height 80px
    const percent = Math.max(0, Math.min(100, ((dbm - minDbm) / (maxDbm - minDbm)) * 100));
    return 90 - (percent / 100) * 80;
  };

  return (
    <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-5 shadow-2xl flex flex-col justify-between relative overflow-hidden h-[400px]">
      <div className="border-b border-white/10 pb-3 mb-4 flex justify-between items-center">
        <div className="flex items-center space-x-2">
          <Cpu className="w-5 h-5 text-cyan-400 animate-pulse" />
          <h4 className="font-semibold text-white tracking-wide text-sm uppercase font-display">Telemetry Insights</h4>
        </div>
        <span className="text-[10px] font-mono font-bold text-slate-500">REALTIME (1Hz)</span>
      </div>

      {/* Battery Capacity Metric SVG */}
      <div className="space-y-2 mb-5">
        <div className="flex justify-between items-center">
          <span className="text-[11px] font-mono font-bold text-slate-300">BATTERY SLOPE METER</span>
          <span className="text-[11px] font-mono text-cyan-400 font-bold">
            {logs.length > 0 ? `${logs[logs.length - 1].batteryPercentage.toFixed(1)}%` : '0.0%'}
          </span>
        </div>
        <div className="h-28 bg-slate-950/40 border border-white/10 rounded-xl overflow-hidden relative p-1.5 flex flex-col justify-end backdrop-blur-sm">
          {chartData.length > 1 ? (
            <svg className="w-full h-full" viewBox="0 0 300 100" preserveAspectRatio="none">
              <defs>
                <linearGradient id="batteryGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.4"/>
                  <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.0"/>
                </linearGradient>
              </defs>
              {/* Reference Gridlines */}
              <line x1="0" y1="10" x2="300" y2="10" stroke="rgba(255,255,255,0.06)" strokeWidth="0.5" strokeDasharray="3,3" />
              <line x1="0" y1="50" x2="300" y2="50" stroke="rgba(255,255,255,0.06)" strokeWidth="0.5" strokeDasharray="3,3" />
              <line x1="0" y1="90" x2="300" y2="90" stroke="rgba(255,255,255,0.06)" strokeWidth="0.5" strokeDasharray="3,3" />
              
              {/* Area under the curve */}
              <path
                d={`M 0,100 L 
                  ${chartData.map((d, index) => `${(index / (chartData.length - 1)) * 300},${getBatteryY(d.batteryPercentage)}`).join(' L ')} 
                  L 300,100 Z`}
                fill="url(#batteryGrad)"
              />
              
              {/* Stroke curve path */}
              <path
                d={chartData.map((d, index) => `${(index / (chartData.length - 1)) * 300},${getBatteryY(d.batteryPercentage)}`).join(' L ')}
                fill="none"
                stroke="#06b6d4"
                strokeWidth="2"
                className="transition-all duration-300"
              />
            </svg>
          ) : (
            <div className="text-[11px] text-slate-500 font-mono text-center mb-6">Awaiting sensor data streams...</div>
          )}
        </div>
      </div>

      {/* Signal Strength DBm Metric SVG */}
      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <span className="text-[11px] font-mono font-bold text-slate-300">LINK RF NOISE FLOOR (dBM)</span>
          <span className="text-[11px] font-mono text-cyan-400 font-bold">
            {logs.length > 0 ? `${logs[logs.length - 1].signalStrengthDbm} dBm` : '-0 dBm'}
          </span>
        </div>
        <div className="h-28 bg-slate-950/40 border border-white/10 rounded-xl overflow-hidden relative p-1.5 flex flex-col justify-end backdrop-blur-sm">
          {chartData.length > 1 ? (
            <svg className="w-full h-full" viewBox="0 0 300 100" preserveAspectRatio="none">
              <defs>
                <linearGradient id="signalGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.4"/>
                  <stop offset="100%" stopColor="#22d3ee" stopOpacity="0.0"/>
                </linearGradient>
              </defs>
              {/* Reference Gridlines */}
              <line x1="0" y1="10" x2="300" y2="10" stroke="rgba(255,255,255,0.06)" strokeWidth="0.5" strokeDasharray="3,3" />
              <line x1="0" y1="50" x2="300" y2="50" stroke="rgba(255,255,255,0.06)" strokeWidth="0.5" strokeDasharray="3,3" />
              <line x1="0" y1="90" x2="300" y2="90" stroke="rgba(255,255,255,0.06)" strokeWidth="0.5" strokeDasharray="3,3" />
              
              {/* Area under the curve */}
              <path
                d={`M 0,100 L 
                  ${chartData.map((d, index) => `${(index / (chartData.length - 1)) * 300},${getSignalY(d.signalStrengthDbm)}`).join(' L ')} 
                  L 300,100 Z`}
                fill="url(#signalGrad)"
              />
              
              {/* Stroke curve path */}
              <path
                d={chartData.map((d, index) => `${(index / (chartData.length - 1)) * 300},${getSignalY(d.signalStrengthDbm)}`).join(' L ')}
                fill="none"
                stroke="#22d3ee"
                strokeWidth="2"
                className="transition-all duration-300"
              />
            </svg>
          ) : (
            <div className="text-[11px] text-slate-500 font-mono text-center mb-6">Awaiting sensor data streams...</div>
          )}
        </div>
      </div>

      <div className="mt-4 pt-3 border-t border-white/10 text-[10px] font-mono text-slate-500 leading-normal">
        Dashboard maps structural coordinates natively. System is designed to feed Spring Boot endpoints at 1Hz frequency interval rate.
      </div>
    </div>
  );
}

export interface TelemetryLogStreamProps {
  logs: TelemetryLog[];
  onClearLogs: () => void;
}

export function TelemetryLogStream({ logs, onClearLogs }: TelemetryLogStreamProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [stateFilter, setStateFilter] = useState<'ALL' | FlightState>('ALL');
  const logContainerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the bottom of the logs container locally without scrolling the viewport
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  // Handle JSON export
  const exportToJson = () => {
    const jsonString = `data:text/json;charset=utf-8,${encodeURIComponent(
      JSON.stringify(logs, null, 2)
    )}`;
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', jsonString);
    downloadAnchor.setAttribute('download', `uav_springboot_telemetry_logs_${Date.now()}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  // Filter logs based on search term and state selected
  const filteredLogs = logs.filter((log) => {
    const matchesSearch =
      log.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.latitude.toString().includes(searchTerm) ||
      log.longitude.toString().includes(searchTerm) ||
      log.altitudeMeters.toString().includes(searchTerm);
    const matchesState = stateFilter === 'ALL' || log.flightState === stateFilter;
    return matchesSearch && matchesState;
  });

  return (
    <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl overflow-hidden shadow-2xl flex flex-col justify-between h-[400px] relative">
      {/* Console Header */}
      <div className="bg-slate-950/40 px-4 py-3 border-b border-white/10 flex flex-wrap items-center justify-between gap-3 backdrop-blur-md">
        <div className="flex items-center space-x-2">
          <Terminal className="w-4 h-4 text-cyan-400" />
          <h4 className="font-semibold text-white tracking-wide text-xs uppercase font-mono">Telemetry Log Stream</h4>
          <span className="h-2 w-2 rounded-full bg-emerald-500 animate-ping" />
        </div>

        <div className="flex items-center space-x-2">
          {/* Search Input */}
          <div className="relative">
            <Search className="absolute left-2 top-2 w-3 h-3 text-slate-400" />
            <input
              id="logger-search"
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search..."
              className="bg-slate-950/60 border border-white/10 rounded-lg px-2 py-1 text-xs text-white pl-7 w-28 focus:outline-none focus:border-cyan-500/40 text-[10px] font-mono h-7 transition-all"
            />
          </div>

          {/* Filter */}
          <div className="relative flex items-center bg-slate-950/60 border border-white/10 rounded-lg px-2 text-[10px] text-slate-400 font-mono h-7">
            <Filter className="w-3 h-3 text-slate-500 mr-1" />
            <select
              id="logger-state-filter"
              value={stateFilter}
              onChange={(e) => setStateFilter(e.target.value as any)}
              className="bg-transparent border-none text-slate-300 focus:outline-[#06b6d4] py-1 cursor-pointer outline-none transition-all leading-none text-[10px] font-mono focus:bg-slate-950"
            >
              <option value="ALL">STATE: ALL</option>
              <option value={FlightState.IDLE}>IDLE</option>
              <option value={FlightState.PLANNING}>PLANNING</option>
              <option value={FlightState.EN_ROUTE}>EN_ROUTE</option>
              <option value={FlightState.EMERGENCY_LANDING}>EMERGENCY</option>
              <option value={FlightState.LANDED_SAFE}>LANDED</option>
            </select>
          </div>

          {/* Clean */}
          <button
            id="btn-clear-logs"
            onClick={onClearLogs}
            title="Clear active telemetry queue"
            className="px-2.5 rounded-lg bg-red-950/35 text-red-400 hover:bg-red-550 hover:text-white border border-red-500/25 transition-all font-mono text-[10px] flex items-center h-7 cursor-pointer"
          >
            <Trash2 className="w-3 h-3 mr-1" />
            Reset
          </button>

          {/* Export JSON */}
          <button
            id="btn-export-logs"
            onClick={exportToJson}
            className="px-3 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-sans font-bold text-[10.5px] flex items-center transition-all h-7 cursor-pointer shadow-md shadow-cyan-500/20"
          >
            <Download className="w-3.5 h-3.5 mr-1" />
            Export JSON
          </button>
        </div>
      </div>

      {/* Console logs box */}
      <div ref={logContainerRef} className="flex-1 bg-slate-950/40 p-4 font-mono text-[10.5px] overflow-auto select-text leading-relaxed font-semibold backdrop-blur-sm">
        {filteredLogs.length > 0 ? (
          <div className="space-y-1">
            {filteredLogs.map((log, index) => (
              <div key={log.id + '-' + index} className="border-b border-slate-950/20 pb-1 hover:bg-white/5 p-1 rounded transition-colors">
                <span className="text-slate-500 select-none mr-2">[{log.timestamp.split('T')[1].slice(0, 8)}]</span>
                <span className="text-cyan-400 font-bold select-none mr-1">INGEST:</span>
                <span className="text-slate-200">
                  ID=<span className="text-amber-400">{log.id}</span> | 
                  ST=<span className={`font-bold ${
                    log.flightState === FlightState.EMERGENCY_LANDING ? 'text-rose-400' :
                    log.flightState === FlightState.EN_ROUTE ? 'text-cyan-400' :
                    log.flightState === FlightState.LANDED_SAFE ? 'text-amber-400' : 'text-slate-300'
                  }`}>{log.flightState}</span> | 
                  POS=[<span className="text-cyan-200">{log.latitude.toFixed(6)}</span>, <span className="text-cyan-200">{log.longitude.toFixed(6)}</span>] | 
                  ALT=<span className="text-cyan-300">{log.altitudeMeters.toFixed(1)}m</span> | 
                  BAT=<span className="text-emerald-300">{log.batteryPercentage.toFixed(1)}%</span> | 
                  SIG=<span className="text-cyan-400">{log.signalStrengthDbm}dBm</span> | 
                  CRYPT=<span className={log.encryptionActive ? 'text-emerald-400' : 'text-red-400'}>{log.encryptionActive ? 'TRUE' : 'FALSE'}</span> | 
                  WND=<span className="text-slate-300">{log.windSpeedKnots.toFixed(1)}kt</span>
                  {log.flightDuration && (
                    <> | DUR=<span className="text-yellow-400 font-bold">{log.flightDuration}</span></>
                  )}
                  {log.detail && (
                    <> | MSG=<span className="text-slate-300 italic">{log.detail}</span></>
                  )}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-slate-500 space-y-1">
            <span className="font-bold">SYSTEM ACTIVE - INGESTION BUFFER MONITORING</span>
            <span>Wait for UAV coordinates initialization to trigger logging queues.</span>
          </div>
        )}
      </div>

      {/* Console footer bar */}
      <div className="bg-slate-950/60 border-t border-white/10 px-4 py-2 flex justify-between items-center text-[10px] text-slate-500 font-mono backdrop-blur-md">
        <span>Active Ingest Buffer: {filteredLogs.length} Records</span>
        <span className="text-slate-400">REST schema matches JPA structure directly.</span>
      </div>
    </div>
  );
}

export default function TelemetryTerminal({ logs, onClearLogs }: TelemetryTerminalProps) {
  return (
    <div id="uav-telemetry-visualizer" className="grid grid-cols-1 lg:grid-cols-12 gap-6 relative z-10">
      
      {/* Dynamic Telemetry Graphs Panel */}
      <div className="lg:col-span-4">
        <TelemetryInsights logs={logs} />
      </div>

      {/* Real-time Logger Console Terminal */}
      <div className="lg:col-span-8">
        <TelemetryLogStream logs={logs} onClearLogs={onClearLogs} />
      </div>

    </div>
  );
}
