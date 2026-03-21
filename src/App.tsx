import React, { useState, useEffect } from 'react';
import { MapPin, Satellite, Activity, AlertTriangle, History, Search, Layers } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import axios from 'axios';

const Sentree = () => {
  const [coords, setCoords] = useState('1.588814, 99.779856'); // Default Amazon coords
  const [monitoring, setMonitoring] = useState(false);
  const [aoiId, setAoiId] = useState<string | null>(null);
  const [history, setHistory] = useState<any>(null);
  const [logs, setLogs] = useState<string[]>([]);

  const addLog = (msg: string) => {
    setLogs(prev => [msg, ...prev].slice(0, 10));
  };

  const startMonitoring = async () => {
    setMonitoring(true);
    addLog(`Initiating monitoring for coords: ${coords}`);
    try {
      const res = await axios.post('/api/monitor', { userId: 'user_123', coords });
      setAoiId(res.data.aoi_id);
      addLog(`Request queued. AOI ID: ${res.data.aoi_id}`);
    } catch (err) {
      addLog('Error initiating monitoring.');
      setMonitoring(false);
    }
  };

  useEffect(() => {
    let interval: any;
    if (aoiId) {
      interval = setInterval(async () => {
        try {
          const res = await axios.get(`/api/history/${aoiId}`);
          if (res.data && !res.data.error) {
            setHistory(res.data);
            addLog(`History updated for ${aoiId}`);
          }
        } catch (err) {
          console.error(err);
        }
      }, 5000);
    }
    return () => clearInterval(interval);
  }, [aoiId]);

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-[#e0e0e0] font-mono selection:bg-emerald-500/30">
      {/* Header */}
      <header className="border-b border-white/10 p-6 flex justify-between items-center bg-black/50 backdrop-blur-md sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-emerald-500 rounded-lg flex items-center justify-center shadow-[0_0_20px_rgba(16,185,129,0.3)]">
            <Satellite className="text-black" size={24} />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tighter uppercase italic">Sentree <span className="text-emerald-500">MVP</span></h1>
            <p className="text-[10px] text-white/40 uppercase tracking-widest">Satellite Deforestation Monitor</p>
          </div>
        </div>
        <div className="flex gap-4 text-[10px] uppercase tracking-widest text-white/60">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            System Active
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-blue-500" />
            Distributed Mocks: Ready
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column: Controls */}
        <div className="lg:col-span-4 space-y-8">
          <section className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-6">
            <div className="flex items-center gap-2 mb-2">
              <MapPin size={16} className="text-emerald-500" />
              <h2 className="text-xs font-semibold uppercase tracking-widest">Area of Interest</h2>
            </div>
            
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-[10px] text-white/40 uppercase">Coordinates (Lat, Lng)</label>
                <input 
                  type="text" 
                  value={coords}
                  onChange={(e) => setCoords(e.target.value)}
                  className="w-full bg-black/50 border border-white/10 rounded-xl p-4 text-sm focus:outline-none focus:border-emerald-500/50 transition-colors"
                  placeholder="1.588814, 99.779856"
                />
              </div>
              
              <button 
                onClick={startMonitoring}
                disabled={monitoring}
                className={`w-full py-4 rounded-xl font-bold uppercase tracking-widest text-xs transition-all flex items-center justify-center gap-2 ${
                  monitoring 
                  ? 'bg-white/10 text-white/40 cursor-not-allowed' 
                  : 'bg-emerald-500 text-black hover:bg-emerald-400 active:scale-[0.98]'
                }`}
              >
                {monitoring ? <Activity className="animate-spin" size={16} /> : <Search size={16} />}
                {monitoring ? 'Monitoring Active' : 'Initiate Scan'}
              </button>
            </div>
          </section>

          <section className="bg-white/5 border border-white/10 rounded-2xl p-6">
            <div className="flex items-center gap-2 mb-4">
              <History size={16} className="text-emerald-500" />
              <h2 className="text-xs font-semibold uppercase tracking-widest">System Logs</h2>
            </div>
            <div className="space-y-2 h-[200px] overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-white/10">
              {logs.map((log, i) => (
                <div key={i} className="text-[10px] text-white/40 border-l border-white/10 pl-3 py-1">
                  <span className="text-emerald-500/50 mr-2">[{new Date().toLocaleTimeString()}]</span>
                  {log}
                </div>
              ))}
              {logs.length === 0 && <div className="text-[10px] text-white/20 italic">Waiting for input...</div>}
            </div>
          </section>
        </div>

        {/* Right Column: Visualization */}
        <div className="lg:col-span-8 space-y-8">
          <div className="bg-white/5 border border-white/10 rounded-2xl p-8 min-h-[500px] flex flex-col">
            <div className="flex justify-between items-start mb-8">
              <div>
                <h2 className="text-2xl font-bold tracking-tighter uppercase italic">Real-Time Analysis</h2>
                <p className="text-xs text-white/40">YOLOv11 Trend Analysis & GEE Time-Series</p>
              </div>
              {history && history.areas[0] > history.areas[1] && history.areas[1] > history.areas[2] && (
                <motion.div 
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="bg-red-500/20 border border-red-500/50 text-red-500 px-4 py-2 rounded-full flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest"
                >
                  <AlertTriangle size={14} />
                  Active Deforestation Alert
                </motion.div>
              )}
            </div>

            <div id="sat-maps" className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-6">
              {(['T-60 Days', 'T-30 Days', 'Current (T0)'] as const).map((label, idx) => {
                // frames[0]=T0, frames[1]=T-30, frames[2]=T-60; display order is T-60→T0 so reverse
                const frame = history?.frames?.[2 - idx];
                const area = history?.areas?.[2 - idx] ?? 0;
                const maxArea = history ? Math.max(...history.areas, 0.01) : 0.01;
                return (
                  <div key={idx} className="space-y-3">
                    {/* Satellite image card with bbox overlay */}
                    <div className="aspect-square bg-black/50 border border-white/10 rounded-2xl relative overflow-hidden">
                      {frame?.imageBase64 ? (
                        <>
                          {/* Real satellite image */}
                          <img
                            src={`data:image/jpeg;base64,${frame.imageBase64}`}
                            alt={`Satellite ${label}`}
                            className="absolute inset-0 w-full h-full object-cover"
                          />
                          {/* Roboflow detection bounding boxes */}
                          {frame.detections?.map((det: any, di: number) => {
                            const IMG = 512;
                            const left = ((det.bbox.x - det.bbox.width / 2) / IMG) * 100;
                            const top  = ((det.bbox.y - det.bbox.height / 2) / IMG) * 100;
                            const w    = (det.bbox.width  / IMG) * 100;
                            const h    = (det.bbox.height / IMG) * 100;
                            return (
                              <div
                                key={di}
                                className="absolute border-2 border-red-500"
                                style={{ left: `${left}%`, top: `${top}%`, width: `${w}%`, height: `${h}%` }}
                              >
                                <span className="absolute -top-4 left-0 bg-red-500 text-white text-[8px] px-1 leading-none py-0.5 whitespace-nowrap">
                                  {det.class} {(det.confidence * 100).toFixed(0)}%
                                </span>
                              </div>
                            );
                          })}
                        </>
                      ) : (
                        /* Placeholder while waiting for results */
                        <div className="absolute inset-0 flex items-center justify-center">
                          {monitoring
                            ? <Activity className="text-emerald-500/40 animate-spin" size={32} />
                            : <Satellite className="text-white/10" size={48} />}
                        </div>
                      )}

                      {/* Bottom gradient overlay with label + date */}
                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-3 flex justify-between items-end">
                        <span className="text-[10px] font-bold uppercase tracking-widest">{label}</span>
                        {frame?.date && (
                          <span className="text-[9px] text-white/50">{frame.date}</span>
                        )}
                      </div>

                      {/* Area badge */}
                      {frame && (
                        <div className="absolute top-2 right-2 bg-black/80 backdrop-blur-md border border-white/10 px-2 py-1 rounded text-[10px] font-mono">
                          {area.toFixed(2)} km²
                        </div>
                      )}
                    </div>

                    {/* Area bar */}
                    <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: frame ? `${(area / maxArea) * 100}%` : '0%' }}
                        className={`h-full rounded-full ${idx === 2 ? 'bg-red-500' : idx === 1 ? 'bg-yellow-500' : 'bg-emerald-500'}`}
                      />
                    </div>

                    {/* Detection count */}
                    {frame?.detections && (
                      <p className="text-[9px] text-white/40 text-center">
                        {frame.detections.length} detection{frame.detections.length !== 1 ? 's' : ''}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            {history && (
              <div className="mt-8 p-6 bg-black/50 border border-white/10 rounded-2xl">
                <div className="flex items-center gap-2 mb-4">
                  <Layers size={16} className="text-emerald-500" />
                  <h3 className="text-[10px] font-bold uppercase tracking-widest">Growth Trend Analysis</h3>
                </div>
                <div className="flex items-end gap-2 h-32">
                  {history.areas.slice().reverse().map((area: number, i: number) => (
                    <div key={i} className="flex-1 flex flex-col items-center gap-2">
                      <motion.div 
                        initial={{ height: 0 }}
                        animate={{ height: `${(area / 10) * 100}%` }}
                        className={`w-full rounded-t-lg ${i === 2 ? 'bg-emerald-500' : 'bg-white/20'}`}
                      />
                      <span className="text-[8px] text-white/40 uppercase tracking-tighter">T-{60 - i*30}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!history && !monitoring && (
              <div className="flex-1 flex flex-col items-center justify-center text-white/20 space-y-4">
                <Satellite size={64} strokeWidth={1} />
                <p className="text-xs uppercase tracking-widest">No active monitoring session</p>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-white/10 p-8 mt-12">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-8">
          <div className="text-[10px] text-white/20 uppercase tracking-widest">
            © 2026 Sentree by Faiz Firdaus.
          </div>
        </div>
      </footer>
    </div>
  );
};

export default function App() {
  return <Sentree />;
}
