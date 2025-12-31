import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { auth, db } from "./firebase";

import { 
  Target, Zap, RefreshCcw, ShieldCheck, Layers, BarChart3, ArrowRightLeft, 
  Scale, Wallet, Percent, Timer, PlusCircle, Trash2, Activity, Hash, 
  Search, Settings2, Wifi, WifiOff, Cloud, AlertTriangle, Info, TrendingDown,
  ArrowDownCircle, ArrowUpCircle, PieChart, Coins, Scissors, CheckCircle2, XCircle,
  TrendingUp, MousePointer2, Calculator, ArrowUpRight, ArrowDownRight, Clock, MapPin
} from 'lucide-react';

if (firebaseConfig && Object.keys(firebaseConfig).length) {
  try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
  } catch (e) {
    console.warn('Firebase initialization failed', e);
  }
} else {
  console.warn('No Firebase config provided; auth/firestore disabled');
}

const appId = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_APP_ID) || (typeof __app_id !== 'undefined' ? __app_id : 'equilibrium-engine-v8');

// --- Utilitas Format Angka ---
const formatNum = (num, fixed = 2) => {
  const n = parseFloat(num);
  if (isNaN(n)) return "0.00";
  if (Math.abs(n) > 0 && Math.abs(n) < 1) {
    return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 });
  }
  return n.toLocaleString('en-US', { minimumFractionDigits: fixed, maximumFractionDigits: fixed });
};

// --- Utilitas Format Durasi ---
const getDuration = (startTime) => {
  const diff = Date.now() - startTime;
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
  const minutes = Math.floor((diff / (1000 * 60)) % 60);
  return `${days}d ${hours}h ${minutes}m`;
};

const App = () => {
  const [activeTab, setActiveTab] = useState('pools'); 
  const [assetType, setAssetType] = useState('ethereum'); 
  const [customTokenId, setCustomTokenId] = useState('');
  const [isCustomMode, setIsCustomMode] = useState(false);
  
  const [initialPrice, setInitialPrice] = useState(2500); 
  const [futurePrice, setFuturePrice] = useState(2600);   
  const [lowPrice, setLowPrice] = useState(2000);         
  const [highPrice, setHighPrice] = useState(3000);       
  const [investment, setInvestment] = useState(1000);     
  const [estAPR, setEstAPR] = useState(50); 
  const [simulatedHours, setSimulatedHours] = useState(24);
  const [shortLeverage, setShortLeverage] = useState(3);

  const [livePositions, setLivePositions] = useState([]);
  const [marketPrices, setMarketPrices] = useState({}); 
  const [lastUpdate, setLastUpdate] = useState(Date.now());
  const [secondsSinceUpdate, setSecondsSinceUpdate] = useState(0);
  const [isPriceLoading, setIsPriceLoading] = useState(false);
  const [apiStatus, setApiStatus] = useState('online'); 
  const [user, setUser] = useState(null);
  const [currentTime, setCurrentTime] = useState(Date.now());

  const firebaseEnabled = !!db && !!auth;

  // --- Auth Flow ---
  useEffect(() => {
    const initAuth = async () => {
      if (!auth) return;
      try {
        const token = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_INITIAL_AUTH_TOKEN) || (typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null);
        if (token) {
          await signInWithCustomToken(auth, token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (e) {
        console.error('Auth error:', e);
      }
    };
    initAuth();
    if (!auth) return;
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  // --- Sinkronisasi Firestore ---
  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'artifacts', appId, 'users', user.uid, 'positions'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const positions = [];
      snapshot.forEach((doc) => positions.push({ id: doc.id, ...doc.data() }));
      setLivePositions(positions);
    }, (err) => console.error("Firestore error:", err));
    return () => unsubscribe();
  }, [user]);

  // --- Load local positions when Firebase/db not available or user not signed in ---
  useEffect(() => {
    if (firebaseEnabled && user) return; // cloud will handle livePositions
    try {
      const raw = localStorage.getItem('local_positions');
      if (raw) {
        const parsed = JSON.parse(raw);
        setLivePositions(parsed || []);
      }
    } catch (e) {
      console.warn('Failed to load local positions', e);
    }
  }, [firebaseEnabled, user]);

  const removePosition = async (id) => {
    if (firebaseEnabled && user && db) {
      try {
        await deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'positions', id));
        return;
      } catch (e) {
        console.error("Gagal menghapus posisi di Firestore:", e);
      }
    }

    // Fallback: remove from localStorage so delete works without Firebase
    try {
      const raw = localStorage.getItem('local_positions');
      const arr = raw ? JSON.parse(raw) : [];
      const filtered = arr.filter(p => p.id !== id);
      localStorage.setItem('local_positions', JSON.stringify(filtered));
      setLivePositions(filtered);
    } catch (e) {
      console.error('Gagal menghapus posisi lokal:', e);
    }
  };

  // --- Timer Counter untuk Last Update & Duration ---
  useEffect(() => {
    const timer = setInterval(() => {
      setSecondsSinceUpdate(Math.floor((Date.now() - lastUpdate) / 1000));
      setCurrentTime(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, [lastUpdate]);

  // --- Fetch Harga Pasar ---
  const fetchPrices = useCallback(async () => {
    if (isPriceLoading) return;
    setIsPriceLoading(true);
    const activeIds = new Set(livePositions.map(p => p.assetType));
    activeIds.add(assetType);
    if (isCustomMode && customTokenId) activeIds.add(customTokenId.toLowerCase().trim());
    const idsString = Array.from(activeIds).filter(Boolean).join(',');
    if (!idsString) { setIsPriceLoading(false); return; }
    try {
      const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${idsString}&vs_currencies=usd`);
      if (res.ok) {
        const data = await res.json();
        setMarketPrices(prev => ({ ...prev, ...Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.usd])) }));
        setApiStatus('online');
        setLastUpdate(Date.now());
      } else { setApiStatus('error'); }
    } catch (e) { setApiStatus('error'); }
    finally { setIsPriceLoading(false); }
  }, [livePositions, assetType, isCustomMode, customTokenId]);

  useEffect(() => {
    fetchPrices();
    const interval = setInterval(fetchPrices, 60000);
    return () => clearInterval(interval);
  }, [fetchPrices]);

  // --- Logika Kalkulasi Equilibrium (V3 + Short) ---
  const calculatePosition = (P_entry, P_current, PL, PH, inv, apr, hours, lev = 3, skipFees = false) => {
    const sqrtP = Math.sqrt(P_entry || 1);
    const sqrtPL = Math.sqrt(PL || 0.1);
    const sqrtPH = Math.sqrt(PH || 100000);
    
    const rangeConst = (sqrtP - sqrtPL) + (P_entry * (1 / sqrtP - 1 / sqrtPH));
    const L = inv / (rangeConst || 1);
    
    const getV3Value = (targetPrice) => {
      const sT = Math.sqrt(targetPrice);
      if (targetPrice <= PL) return L * (1 / sqrtPL - 1 / sqrtPH) * targetPrice;
      if (targetPrice >= PH) return L * (sqrtPH - sqrtPL);
      return (L * (sT - sqrtPL)) + (L * (1 / sT - 1 / sqrtPH) * targetPrice);
    };

    const v3ValueCurrent = getV3Value(P_current);
    const pnlLP = v3ValueCurrent - inv;

    const v3atLow = getV3Value(PL);
    const v3atHigh = getV3Value(PH);
    const balancedShortSize = (v3atLow - v3atHigh) / (PL - PH || 1);
    const shortPnL = (P_entry - P_current) * balancedShortSize;
    
    const dailyRate = apr / 100 / 365;
    const accumulatedFees = skipFees ? 0 : inv * (dailyRate / 24) * hours;
    const totalNetPnL = pnlLP + shortPnL + accumulatedFees;

    const liqPrice = P_entry * (1 + (1 / (lev || 3)));
    const distToLiq = ((liqPrice - P_current) / P_current) * 100;

    const isOOR = P_current < PL || P_current > PH;

    const v3ValueAtLow = getV3Value(PL);
    const v3ValueAtHigh = getV3Value(PH);
    const shortPnLAtLow = (P_entry - PL) * balancedShortSize;
    const shortPnLAtHigh = (P_entry - PH) * balancedShortSize;
    
    const maxLossLow = (v3ValueAtLow - inv) + shortPnLAtLow;
    const maxLossHigh = (v3ValueAtHigh - inv) + shortPnLAtHigh;

    const rawPricePnL = pnlLP + shortPnL;
    const feesToBEP = rawPricePnL < 0 ? Math.abs(rawPricePnL) : 0;

    return { 
      pnlLP, shortPnL, accumulatedFees, totalNetPnL, balancedShortSize, 
      v3ValueCurrent, liqPrice, distToLiq, isOOR,
      shortValueUSD: balancedShortSize * P_current,
      tokenAmount: L * (1 / sqrtP - 1 / sqrtPH),
      usdcAmount: L * (sqrtP - sqrtPL),
      equityValue: v3ValueCurrent + shortPnL,
      maxLossLow, maxLossHigh,
      feesToBEP: Math.max(0, feesToBEP)
    };
  };

  const planner = useMemo(() => 
    calculatePosition(initialPrice, futurePrice, lowPrice, highPrice, investment, estAPR, simulatedHours, shortLeverage, false),
  [initialPrice, futurePrice, lowPrice, highPrice, investment, estAPR, simulatedHours, shortLeverage]);

  const savePos = async () => {
    const assetId = isCustomMode ? customTokenId.toLowerCase().trim() : assetType;
    const payload = {
      id: `pos_${Date.now()}`,
      assetType: assetId,
      initialPrice: initialPrice,
      lowPrice: lowPrice,
      highPrice: highPrice,
      investment: investment,
      estAPR: estAPR,
      shortLeverage: shortLeverage,
      startTime: Date.now()
    };

    if (firebaseEnabled && user && db) {
      try {
        await setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'positions', payload.id), payload);
        setActiveTab('live');
        return;
      } catch (e) {
        console.error('Failed to save to Firestore, falling back to localStorage', e);
      }
    }

    // Fallback: save locally so the button still works without Firebase
    try {
      const raw = localStorage.getItem('local_positions');
      const arr = raw ? JSON.parse(raw) : [];
      arr.push(payload);
      localStorage.setItem('local_positions', JSON.stringify(arr));
      setLivePositions(arr);
      setActiveTab('live');
      console.warn('Saved position to localStorage (Firebase not configured)');
    } catch (e) {
      console.error('Failed to save fallback position locally', e);
    }
  };

  return (
    <div className="min-h-screen bg-[#08090d] text-slate-300 p-4 md:p-8 font-sans">
      <div className="max-w-6xl mx-auto space-y-8">
        {/* Navbar */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="flex items-center space-x-4">
            <div className="p-3 bg-indigo-600 rounded-2xl shadow-xl shadow-indigo-500/20">
              <Scale className="text-white" size={24} />
            </div>
            <div>
              <h1 className="text-2xl font-black text-white italic tracking-tighter uppercase">0xPhantasia Delta Neutral</h1>
              <span className="text-[9px] font-bold text-indigo-400 uppercase tracking-[0.3em]">Concentrated Liquidity Matrix</span>
            </div>
          </div>
          <div className="bg-[#11141d] p-1 rounded-xl border border-slate-800 flex">
            <button onClick={() => setActiveTab('pools')} className={`px-6 py-2 rounded-lg text-[10px] font-black uppercase transition-all ${activeTab === 'pools' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20' : 'text-slate-500 hover:text-slate-300'}`}>Simulator</button>
            <button onClick={() => setActiveTab('live')} className={`px-6 py-2 rounded-lg text-[10px] font-black uppercase transition-all ${activeTab === 'live' ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/20' : 'text-slate-500 hover:text-slate-300'}`}>Live Cloud ({livePositions.length})</button>
          </div>
        </div>

        {activeTab === 'pools' ? (
          <div className="grid lg:grid-cols-12 gap-8">
            {/* Panel Input */}
            <div className="lg:col-span-4 space-y-6">
              <div className="bg-[#11141d] border border-slate-800 rounded-[32px] p-6 shadow-2xl space-y-6">
                <div className="flex justify-between items-center">
                  <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center italic">
                    <TrendingDown className="mr-2 text-indigo-500" size={14} /> Konfigurasi Token
                  </h3>
                  {apiStatus === 'online' ? <Wifi size={12} className="text-emerald-500" /> : <WifiOff size={12} className="text-red-500" />}
                </div>

                <div className="grid grid-cols-2 gap-2">
                  {['ethereum', 'solana'].map(id => (
                    <button key={id} onClick={() => {setAssetType(id); setIsCustomMode(false);}} className={`py-2.5 rounded-xl text-[10px] font-bold border uppercase transition-all ${!isCustomMode && assetType === id ? 'border-indigo-500 bg-indigo-500/10 text-white' : 'border-slate-800 text-slate-500'}`}>{id.slice(0,3)}</button>
                  ))}
                </div>

                <div className={`p-4 rounded-2xl border transition-all ${isCustomMode ? 'border-indigo-500 bg-indigo-500/5' : 'border-slate-800'}`}>
                  <label className="text-[9px] font-black text-slate-500 uppercase block mb-1">Custom CoinGecko ID</label>
                  <input value={customTokenId} onFocus={() => setIsCustomMode(true)} onChange={(e) => setCustomTokenId(e.target.value)} placeholder="e.g. monad-testnet" className="w-full bg-transparent outline-none font-mono text-sm text-white" />
                </div>

                <div className="space-y-4 pt-4 border-t border-slate-800/50">
                  <div className="bg-[#08090d] p-4 rounded-2xl border border-slate-800 focus-within:border-indigo-500 transition-colors">
                    <label className="text-[9px] font-black text-slate-500 uppercase block mb-1">Total Modal (USDC)</label>
                    <input type="number" value={investment} onChange={e => setInvestment(Number(e.target.value))} className="w-full bg-transparent outline-none font-mono text-xl text-white font-bold" />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-[#08090d] p-3 rounded-xl border border-slate-800">
                      <label className="text-[8px] font-black text-slate-500 uppercase block mb-1">Harga Entri</label>
                      <input type="number" value={initialPrice} onChange={e => setInitialPrice(Number(e.target.value))} className="w-full bg-transparent outline-none font-mono text-sm text-white" />
                    </div>
                    <div className="bg-[#08090d] p-3 rounded-xl border border-indigo-900/30">
                      <label className="text-[8px] font-black text-indigo-400 uppercase block mb-1">Simulasi Harga</label>
                      <input type="number" value={futurePrice} onChange={e => setFuturePrice(Number(e.target.value))} className="w-full bg-transparent outline-none font-mono text-sm text-white" />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="bg-red-500/5 p-3 rounded-xl border border-red-500/20">
                      <label className="text-[8px] font-black text-red-500 uppercase block mb-1 text-center">Batas Bawah (Low)</label>
                      <input type="number" value={lowPrice} onChange={e => setLowPrice(Number(e.target.value))} className="w-full bg-transparent outline-none font-mono text-sm text-white text-center font-bold" />
                    </div>
                    <div className="bg-emerald-500/5 p-3 rounded-xl border border-emerald-500/20">
                      <label className="text-[8px] font-black text-emerald-500 uppercase block mb-1 text-center">Batas Atas (High)</label>
                      <input type="number" value={highPrice} onChange={e => setHighPrice(Number(e.target.value))} className="w-full bg-transparent outline-none font-mono text-sm text-white text-center font-bold" />
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="bg-[#08090d] p-4 rounded-2xl border border-slate-800">
                    <div className="flex justify-between mb-3">
                      <label className="text-[9px] font-black text-slate-500 uppercase">Estimated APR (%)</label>
                      <span className="text-xs font-mono font-bold text-emerald-400">{estAPR}%</span>
                    </div>
                    <input type="range" min="0" max="500" step="5" value={estAPR} onChange={e => setEstAPR(Number(e.target.value))} className="w-full h-1 bg-slate-800 rounded-full appearance-none accent-emerald-500" />
                  </div>

                  <div className="bg-[#08090d] p-4 rounded-2xl border border-slate-800">
                    <div className="flex justify-between mb-3">
                      <label className="text-[9px] font-black text-slate-500 uppercase">Leverage Short</label>
                      <span className="text-xs font-mono font-bold text-indigo-400">{shortLeverage}x</span>
                    </div>
                    <input type="range" min="1" max="10" step="0.5" value={shortLeverage} onChange={e => setShortLeverage(Number(e.target.value))} className="w-full h-1 bg-slate-800 rounded-full appearance-none accent-indigo-500" />
                  </div>
                </div>

                <button onClick={savePos} className="w-full py-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl font-black text-[10px] uppercase tracking-[0.2em] shadow-lg shadow-indigo-600/20 transition-all flex items-center justify-center">
                  <PlusCircle size={16} className="mr-2" /> Simpan Posisi ke Cloud
                </button>
              </div>
            </div>

            {/* Panel Hasil Simulator */}
            <div className="lg:col-span-8 space-y-6">
              <div className="bg-[#11141d] border border-slate-800 rounded-[40px] overflow-hidden shadow-2xl">
                <div className="p-8 border-b border-slate-800 bg-gradient-to-br from-indigo-500/5 via-transparent to-transparent">
                  <div className="flex justify-between items-start mb-6">
                    <div>
                      <h4 className="text-5xl font-black text-white tracking-tighter">${formatNum(planner.totalNetPnL)}</h4>
                      <p className="text-indigo-400 text-[9px] font-black uppercase tracking-[0.3em] mt-2 italic flex items-center">
                        <Target size={14} className="mr-2" /> Estimasi Profit (Simulasi)
                      </p>
                    </div>
                    <div className="text-right">
                      <span className="text-[9px] font-bold text-slate-500 uppercase">ROI Kapital</span>
                      <p className={`text-xl font-mono font-black ${planner.totalNetPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {formatNum((planner.totalNetPnL / investment) * 100)}%
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="bg-[#08090d] p-4 rounded-2xl border border-slate-800">
                      <span className="text-[8px] font-black text-slate-500 uppercase block mb-1">PnL Short</span>
                      <span className={`text-xs font-mono font-bold ${planner.shortPnL >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                        ${formatNum(planner.shortPnL)}
                      </span>
                    </div>
                    <div className="bg-[#08090d] p-4 rounded-2xl border border-slate-800">
                      <span className="text-[8px] font-black text-slate-500 uppercase block mb-1">Liquidation</span>
                      <span className="text-xs font-mono font-bold text-red-500">${formatNum(planner.liqPrice)}</span>
                    </div>
                    <div className="bg-[#08090d] p-4 rounded-2xl border border-emerald-500/20 shadow-[0_0_15px_rgba(16,185,129,0.05)]">
                      <span className="text-[8px] font-black text-emerald-500 uppercase block mb-1 flex items-center">
                         Sim. Fees <Percent size={10} className="ml-1" />
                      </span>
                      <span className="text-xs font-mono font-bold text-emerald-400">+${formatNum(planner.accumulatedFees)}</span>
                    </div>
                    <div className="bg-[#08090d] p-4 rounded-2xl border border-slate-800">
                      <span className="text-[8px] font-black text-slate-500 uppercase block mb-1">LP Value</span>
                      <span className="text-xs font-mono font-bold text-indigo-400">${formatNum(planner.v3ValueCurrent)}</span>
                    </div>
                  </div>
                </div>

                <div className="p-8 space-y-8">
                  <div className="grid grid-cols-2 gap-4">
                     <div className="bg-red-500/5 border border-red-500/20 p-4 rounded-2xl">
                        <span className="text-[8px] font-black text-red-500 uppercase block mb-1 tracking-widest">Est Max Loss @Low (OOR)</span>
                        <p className="text-lg font-mono font-black text-white">${formatNum(planner.maxLossLow)}</p>
                     </div>
                     <div className="bg-orange-500/5 border border-orange-500/20 p-4 rounded-2xl">
                        <span className="text-[8px] font-black text-orange-500 uppercase block mb-1 tracking-widest">Est Max Loss @High (OOR)</span>
                        <p className="text-lg font-mono font-black text-white">${formatNum(planner.maxLossHigh)}</p>
                     </div>
                  </div>

                  <div className="bg-[#08090d]/80 border border-indigo-500/30 rounded-3xl p-6 relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-8 opacity-5">
                       <TrendingDown size={120} className="text-indigo-500" />
                    </div>
                    <div className="relative z-10 flex flex-col md:flex-row justify-between items-center gap-6">
                      <div className="flex items-center space-x-4">
                        <div className="p-4 bg-indigo-500/10 rounded-2xl text-indigo-400 border border-indigo-500/20">
                          <Scissors size={24} />
                        </div>
                        <div>
                          <h5 className="text-[10px] font-black text-white uppercase tracking-widest italic flex items-center">
                            Hedging Specs (Short Position)
                          </h5>
                          <p className="text-slate-500 text-[9px] font-medium mt-1 uppercase tracking-tighter">Ukuran ideal untuk menjaga Delta Neutral</p>
                        </div>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-8 w-full md:w-auto">
                        <div className="text-center md:text-right">
                          <span className="text-[8px] font-black text-slate-500 uppercase block mb-1 tracking-widest">Short Size</span>
                          <span className="text-2xl font-mono font-black text-indigo-400">{formatNum(planner.balancedShortSize, 4)}</span>
                        </div>
                        <div className="text-center md:text-right">
                          <span className="text-[8px] font-black text-slate-500 uppercase block mb-1 tracking-widest">Market Value</span>
                          <span className="text-2xl font-mono font-black text-white">${formatNum(planner.shortValueUSD)}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="grid md:grid-cols-2 gap-6">
                    <div className="bg-[#08090d] p-6 rounded-[24px] border border-slate-800 flex flex-col justify-center">
                      <div className="flex justify-between mb-2 text-[9px] font-black uppercase">
                        <span className="text-indigo-400">{isCustomMode ? customTokenId : assetType}</span>
                        <span className="text-emerald-400">USDC</span>
                      </div>
                      <div className="h-6 w-full rounded-full overflow-hidden flex border border-slate-800/50">
                        <div style={{ width: `${(planner.tokenAmount * initialPrice / investment) * 100}%` }} className="h-full bg-gradient-to-r from-indigo-600 to-indigo-400"></div>
                        <div style={{ width: `${(planner.usdcAmount / investment) * 100}%` }} className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400"></div>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div className="bg-[#0d111a] p-4 rounded-2xl border border-indigo-500/20 flex items-center justify-between">
                        <span className="text-[8px] font-black text-slate-500 uppercase">Deposit {isCustomMode ? 'Token' : assetType.slice(0,3)}</span>
                        <span className="text-lg font-mono font-black text-white">{formatNum(planner.tokenAmount, 6)}</span>
                      </div>
                      <div className="bg-[#0d111a] p-4 rounded-2xl border border-emerald-500/20 flex items-center justify-between">
                        <span className="text-[8px] font-black text-slate-500 uppercase">Deposit USDC</span>
                        <span className="text-lg font-mono font-black text-white">${formatNum(planner.usdcAmount)}</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="p-8 bg-[#08090d]/50 border-t border-slate-800">
                  <div className="flex justify-between items-center mb-4">
                    <h6 className="text-[10px] font-black text-slate-500 uppercase tracking-widest italic">Simulasi Waktu (Simulator Only)</h6>
                    <span className="text-xs font-mono font-bold text-indigo-400 bg-indigo-500/10 px-3 py-1 rounded-full">{Math.floor(simulatedHours / 24)} Hari</span>
                  </div>
                  <input type="range" min="1" max="720" value={simulatedHours} onChange={e => setSimulatedHours(Number(e.target.value))} className="w-full h-1.5 bg-slate-800 rounded-full appearance-none accent-indigo-500" />
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* Live Monitoring Tab */
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-6 duration-700">
            <div className="flex justify-between items-end">
              <div>
                <h2 className="text-3xl font-black text-white italic uppercase tracking-tighter">Live Position Tracker</h2>
                <div className="flex flex-wrap items-center gap-3 mt-2">
                   <p className="text-slate-500 text-[10px] font-bold uppercase tracking-widest flex items-center">
                     <Cloud size={14} className="mr-2 text-indigo-500" /> Real-time Cloud Tracker
                   </p>
                   <div className="flex items-center gap-1.5 px-3 py-1 bg-slate-900 border border-slate-800 rounded-full">
                      <Clock size={10} className="text-indigo-400" />
                      <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Update: {secondsSinceUpdate}s ago</span>
                   </div>
                </div>
              </div>
            </div>

            {livePositions.length === 0 ? (
              <div className="bg-[#11141d] border-2 border-dashed border-slate-800 rounded-[48px] p-32 text-center">
                <Layers size={48} className="mx-auto text-slate-800 mb-6" />
                <p className="text-slate-500 font-black uppercase text-xs tracking-[0.3em]">Belum ada posisi tersimpan.</p>
                <button onClick={() => setActiveTab('pools')} className="mt-8 px-10 py-4 bg-indigo-600 rounded-2xl text-[10px] font-black uppercase tracking-widest text-white shadow-2xl hover:scale-105 transition-all">Kembali ke Simulator</button>
              </div>
            ) : (
              <div className="grid md:grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-8">
                {livePositions.map(pos => {
                  const currentPrice = marketPrices[pos.assetType] || pos.initialPrice;
                  const stats = calculatePosition(pos.initialPrice, currentPrice, pos.lowPrice, pos.highPrice, pos.investment, pos.estAPR, 0, pos.shortLeverage, true);
                  const isCritical = stats.distToLiq < 10;
                  const durationStr = getDuration(pos.startTime);

                  return (
                    <div key={pos.id} className="relative group">
                      <div className={`absolute -inset-1 rounded-[44px] opacity-20 blur-xl transition-all duration-500 group-hover:opacity-40 ${isCritical ? 'bg-red-500' : 'bg-indigo-500'}`}></div>
                      
                      <div className={`relative bg-[#11141d] border rounded-[40px] overflow-hidden transition-all duration-300 ${isCritical ? 'border-red-500/30' : 'border-slate-800/50 hover:border-indigo-500/40'} shadow-2xl`}>
                        
                        {/* Header Area */}
                        <div className="px-8 py-6 bg-gradient-to-b from-slate-800/20 to-transparent flex justify-between items-center">
                           <div className="flex items-center space-x-3">
                              <div className="p-2 bg-slate-900 rounded-xl border border-slate-700/50">
                                 <Activity size={18} className={isCritical ? 'text-red-400' : 'text-indigo-400'} />
                              </div>
                              <div>
                                 <h4 className="text-[14px] font-black text-white uppercase tracking-tighter leading-none">{pos.assetType}</h4>
                                 <div className="flex items-center gap-2 mt-2">
                                    <div className="flex items-center gap-1 px-1.5 py-0.5 bg-indigo-500/10 rounded border border-indigo-500/20">
                                       <MapPin size={8} className="text-indigo-400" />
                                       <span className="text-[8px] font-mono font-bold text-indigo-300 uppercase tracking-tighter">Entry: ${formatNum(pos.initialPrice)}</span>
                                    </div>
                                    <div className="flex items-center gap-1 px-1.5 py-0.5 bg-slate-800 rounded border border-slate-700">
                                       <Timer size={8} className="text-slate-400" />
                                       <span className="text-[8px] font-mono font-bold text-slate-300 uppercase tracking-tighter">{durationStr}</span>
                                    </div>
                                 </div>
                              </div>
                           </div>
                           <button onClick={() => removePosition(pos.id)} className="w-8 h-8 rounded-full bg-slate-900/50 flex items-center justify-center text-slate-600 hover:text-red-400 transition-all border border-slate-800/50">
                              <Trash2 size={14} />
                           </button>
                        </div>

                        {/* Main PnL Section */}
                        <div className="px-8 pb-4">
                           <div className="bg-slate-900/40 rounded-[32px] p-6 border border-slate-800/50 shadow-inner">
                              <div className="flex justify-between items-center mb-1">
                                 <span className="text-[9px] font-black text-slate-500 uppercase tracking-[0.2em]">Live PnL Tracking</span>
                                 <span className={`text-[10px] font-mono font-black px-2 py-0.5 rounded-lg ${stats.equityValue - pos.investment >= 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
                                    {stats.equityValue - pos.investment >= 0 ? '+' : ''}{formatNum(((stats.equityValue - pos.investment) / pos.investment) * 100)}%
                                 </span>
                              </div>
                              <h2 className={`text-4xl font-black font-mono tracking-tight ${stats.equityValue - pos.investment >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                 ${formatNum(stats.equityValue - pos.investment)}
                              </h2>
                              
                              <div className="grid grid-cols-2 gap-3 mt-5">
                                 <div className="flex items-center gap-2">
                                    <div className={`p-1.5 rounded-lg ${stats.pnlLP >= 0 ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500'}`}>
                                       {stats.pnlLP >= 0 ? <ArrowUpRight size={10}/> : <ArrowDownRight size={10}/>}
                                    </div>
                                    <div>
                                       <p className="text-[7px] font-black text-slate-500 uppercase">LP PnL</p>
                                       <p className={`text-[11px] font-mono font-bold ${stats.pnlLP >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>${formatNum(stats.pnlLP)}</p>
                                    </div>
                                 </div>
                                 <div className="flex items-center gap-2">
                                    <div className={`p-1.5 rounded-lg ${stats.shortPnL >= 0 ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500'}`}>
                                       {stats.shortPnL >= 0 ? <ArrowUpRight size={10}/> : <ArrowDownRight size={10}/>}
                                    </div>
                                    <div>
                                       <p className="text-[7px] font-black text-slate-500 uppercase">Short PnL</p>
                                       <p className={`text-[11px] font-mono font-bold ${stats.shortPnL >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>${formatNum(stats.shortPnL)}</p>
                                    </div>
                                 </div>
                              </div>
                           </div>
                        </div>

                        {/* Detailed Stats Grid */}
                        <div className="px-8 space-y-4 pb-8 mt-2">
                           <div className="flex items-center justify-between px-2">
                              <div className="flex flex-col">
                                 <span className="text-[8px] font-black text-white uppercase italic">Equity Value</span>
                                 <span className="text-sm font-mono font-black text-indigo-400">${formatNum(stats.equityValue)}</span>
                              </div>
                              <div className="h-8 w-[1px] bg-slate-800"></div>
                              <div className="flex flex-col text-right">
                                 <span className="text-[8px] font-black text-slate-500 uppercase italic">Investment</span>
                                 <span className="text-sm font-mono font-black text-slate-400">${formatNum(pos.investment)}</span>
                              </div>
                           </div>

                           {/* Max Loss Scenarios */}
                           <div className="grid grid-cols-2 gap-3">
                              <div className="p-3 rounded-2xl bg-red-500/5 border border-red-500/10">
                                 <p className="text-[7px] font-black text-red-500 uppercase mb-1">Max Loss @Low</p>
                                 <p className="text-sm font-mono font-black text-white">${formatNum(stats.maxLossLow)}</p>
                              </div>
                              <div className="p-3 rounded-2xl bg-orange-500/5 border border-orange-500/10 text-right">
                                 <p className="text-[7px] font-black text-orange-500 uppercase mb-1">Max Loss @High</p>
                                 <p className="text-sm font-mono font-black text-white">${formatNum(stats.maxLossHigh)}</p>
                              </div>
                           </div>

                           {/* Recovery / BEP Info */}
                           <div className={`p-4 rounded-[24px] border flex justify-between items-center transition-all ${stats.feesToBEP > 0 ? 'bg-orange-500/5 border-orange-500/20' : 'bg-emerald-500/10 border-emerald-500/30'}`}>
                              <div className="flex items-center gap-3">
                                 <div className={`p-2 rounded-xl ${stats.feesToBEP > 0 ? 'bg-orange-500/20 text-orange-400' : 'bg-emerald-500/20 text-emerald-400'}`}>
                                    <Calculator size={14} />
                                 </div>
                                 <div>
                                    <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">Fees Needed to BEP</p>
                                    <p className={`text-sm font-mono font-black ${stats.feesToBEP > 0 ? 'text-white' : 'text-emerald-400'}`}>
                                       {stats.feesToBEP > 0 ? `$${formatNum(stats.feesToBEP)}` : 'RECOVERED'}
                                    </p>
                                 </div>
                              </div>
                           </div>

                           {/* Market Track Visualizer */}
                           <div className="space-y-3 pt-4 border-t border-slate-800/50">
                              <div className="flex justify-between items-center px-1">
                                 <div className="flex items-center gap-2 text-[8px] font-black text-slate-500 uppercase tracking-tighter">
                                    <TrendingUp size={10} />
                                    <span>Current Price</span>
                                 </div>
                                 <span className={`text-[10px] font-mono font-black ${stats.isOOR ? 'text-red-400' : 'text-white'}`}>
                                    ${formatNum(currentPrice)}
                                 </span>
                              </div>
                              
                              <div className="relative h-2.5 w-full bg-slate-900 rounded-full border border-slate-800 overflow-hidden">
                                 <div className={`absolute inset-y-0 bg-indigo-500/10 border-x border-indigo-500/20`} style={{ left: '15%', right: '15%' }}></div>
                                 <div 
                                    className={`absolute top-0 bottom-0 w-1 z-10 transition-all duration-1000 ${stats.isOOR ? 'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.8)]' : 'bg-white shadow-[0_0_8px_white]'}`}
                                    style={{ left: `${Math.min(100, Math.max(0, ((currentPrice - (pos.lowPrice * 0.8)) / ((pos.highPrice * 1.2) - (pos.lowPrice * 0.8))) * 100))}%` }}
                                 ></div>
                              </div>
                              
                              <div className="flex justify-between px-1">
                                 <div className="flex flex-col">
                                    <span className="text-[7px] font-black text-slate-600 uppercase">Range Low</span>
                                    <span className="text-[9px] font-mono font-bold text-red-400/80">${formatNum(pos.lowPrice)}</span>
                                 </div>
                                 <div className="flex flex-col text-right">
                                    <span className="text-[7px] font-black text-slate-600 uppercase">Range High</span>
                                    <span className="text-[9px] font-mono font-bold text-emerald-400/80">${formatNum(pos.highPrice)}</span>
                                 </div>
                              </div>
                           </div>
                        </div>

                        {/* Liq Warning Footer */}
                        {isCritical && (
                           <div className="bg-red-500/20 py-2 px-8 flex items-center gap-2 border-t border-red-500/30">
                              <AlertTriangle size={12} className="text-red-400" />
                              <span className="text-[8px] font-black text-red-200 uppercase tracking-widest italic text-center w-full">
                                 Danger: Liq Price ${formatNum(stats.liqPrice)}
                              </span>
                           </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="max-w-6xl mx-auto mt-20 pt-8 border-t border-slate-900 flex justify-between items-center opacity-20">
        <div className="flex items-center space-x-3 text-[9px] font-black text-slate-600 uppercase tracking-widest italic">
          <Activity size={12} />
          <span>Equilibrium Engine Infrastructure • High-Precision V3 Composition Matrix</span>
        </div>
      </div>
    </div>
  );
};

export default App;
