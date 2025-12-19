// ==========================================
// 1. KONFIGURASI SUPABASE
// ==========================================
const supabaseUrl = 'https://mbccvmalvbdxbornqtqc.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1iY2N2bWFsdmJkeGJvcm5xdHFjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU5MDc1MzEsImV4cCI6MjA4MTQ4MzUzMX0.FicPHqOtziJuac5OrNvTc9OG7CEK4Bn_G9F9CYR-N3s';
let db;
try {
    db = supabase.createClient(supabaseUrl, supabaseKey);
} catch (e) {
    console.error("Supabase init error:", e);
    alert("Gagal koneksi database. Cek koneksi internet.");
}

// ==========================================
// 2. GLOBAL VARIABLES
// ==========================================
let currentUser = null;
let allStocks = [];       
let myPortfolio = [];     
let currentFilter = 'ALL';
let priceChart = null, stochChart = null;
let portfolioModalInstance = null, strategyModalInstance = null;

const STRATEGIES = {
    'conservative': { tp: 15, cl: 7, ma: 50, rsi: 14, desc: "Swing (Santai). Fokus: Big Cap & Trend." },
    'moderate':     { tp: 8,  cl: 4, ma: 20, rsi: 14, desc: "Day Trade. Fokus: Balanced." },
    'aggressive':   { tp: 3,  cl: 2, ma: 5,  rsi: 14, desc: "Scalping. Fokus: Volatility & Volume." }
};

// ==========================================
// 3. WINDOW FUNCTIONS
// ==========================================
window.triggerRender = function() {
    renderMarketOverview(allStocks);
};

window.openStrategyModal = function() {
    if (!strategyModalInstance) {
        const el = document.getElementById('strategyModal');
        if(el) strategyModalInstance = new bootstrap.Modal(el);
    }
    const elTp = document.getElementById('default-tp');
    const elCl = document.getElementById('default-cl');
    const elMa = document.getElementById('default-ma');
    const elRsi = document.getElementById('default-rsi');
    const elPreset = document.getElementById('strategy-preset');
    
    if(elPreset) elPreset.value = localStorage.getItem('def_preset') || 'custom';
    if(elTp) elTp.value = localStorage.getItem('def_tp') || '';
    if(elCl) elCl.value = localStorage.getItem('def_cl') || '';
    if(elMa) elMa.value = localStorage.getItem('def_ma') || '20';
    if(elRsi) elRsi.value = localStorage.getItem('def_rsi') || '14';

    window.applyStrategyPreset();
    if(strategyModalInstance) strategyModalInstance.show();
};

window.applyStrategyPreset = function() {
    const elPreset = document.getElementById('strategy-preset');
    if (!elPreset) return;
    const val = elPreset.value;
    const elDesc = document.getElementById('strategy-desc');
    const elTp = document.getElementById('default-tp');
    const elCl = document.getElementById('default-cl');
    const elMa = document.getElementById('default-ma');
    const elRsi = document.getElementById('default-rsi');

    if (val === 'custom') {
        elDesc.innerText = "Mode Manual: Anda bebas menentukan angka.";
        elTp.disabled = false; elCl.disabled = false; elMa.disabled = false; elRsi.disabled = false;
    } else {
        const strat = STRATEGIES[val];
        if (strat) {
            elTp.value = strat.tp; elCl.value = strat.cl;
            elMa.value = strat.ma; elRsi.value = strat.rsi;
            elDesc.innerText = strat.desc;
            elTp.disabled = true; elCl.disabled = true; elMa.disabled = true; elRsi.disabled = true;
        }
    }
};

window.setFilter = function(type) {
    currentFilter = type;
    applyFilterAndRender();
};

window.sortTable = function(n) {
    const tableBody = document.getElementById('table-body');
    if(!tableBody) return;
    const rows = Array.from(tableBody.querySelectorAll('tr'));
    tableBody.dataset.sortDir = tableBody.dataset.sortDir === 'asc' ? 'desc' : 'asc';
    const dir = tableBody.dataset.sortDir;

    rows.sort((rowA, rowB) => {
        let valA = rowA.children[n].innerText.trim();
        let valB = rowB.children[n].innerText.trim();
        const parseNum = (str) => {
            const match = str.match(/[-+]?[0-9]*\.?[0-9]+/);
            if(!match) return str;
            return parseFloat(match[0].replace(/\./g, '').replace(',', '.'));
        };
        const a = parseNum(valA); const b = parseNum(valB);
        if (a < b) return dir === 'asc' ? -1 : 1;
        if (a > b) return dir === 'asc' ? 1 : -1;
        return 0;
    });
    rows.forEach(row => tableBody.appendChild(row));
};

window.openPortfolioModal = function(kode) {
    if (!portfolioModalInstance) {
        const el = document.getElementById('portfolioModal');
        if(el) portfolioModalInstance = new bootstrap.Modal(el);
    }
    const stock = allStocks.find(s => s.kode_saham === kode);
    const owned = myPortfolio.find(p => p.kode_saham === kode);
    
    document.getElementById('modal-kode-saham').innerText = kode;
    document.getElementById('modal-nama-perusahaan').innerText = stock ? stock.nama_perusahaan : '';
    document.getElementById('input-kode').value = kode;
    
    const formAvg = document.getElementById('input-avg');
    const formLots = document.getElementById('input-lots');
    const formTp = document.getElementById('input-tp-pct');
    const formCl = document.getElementById('input-cl-pct');
    const formNotes = document.getElementById('input-notes');
    const checkW = document.getElementById('input-watchlist');
    const btnDel = document.getElementById('btn-delete-portfolio');

    if (owned) {
        formAvg.value = owned.avg_price; formLots.value = owned.lots;
        formTp.value = owned.tp_pct || ''; formCl.value = owned.cl_pct || '';
        formNotes.value = owned.notes || ''; checkW.checked = owned.is_watchlist;
        btnDel.style.display = 'block';
    } else {
        formAvg.value = stock ? stock.penutupan : 0; formLots.value = 1;
        formTp.value = localStorage.getItem('def_tp') || '';
        formCl.value = localStorage.getItem('def_cl') || '';
        formNotes.value = ''; checkW.checked = false;
        btnDel.style.display = 'none';
    }
    updateCalc();
    if(portfolioModalInstance) portfolioModalInstance.show();
    setTimeout(() => { loadAndRenderChart(kode); }, 500);
};

window.toggleWatchlist = async function(kode) {
    if(!currentUser) return;
    const owned = myPortfolio.find(p => p.kode_saham === kode);
    const newStatus = owned ? !owned.is_watchlist : true;
    const payload = { user_id: currentUser.id, kode_saham: kode, is_watchlist: newStatus };
    if (!owned) { payload.avg_price = 0; payload.lots = 0; }
    const { error } = await db.from('portfolio').upsert(payload, { onConflict: 'user_id, kode_saham' });
    if(!error) await loadData(); else showAlert('danger', 'Gagal update watchlist');
};

// ==========================================
// 4. AUTH & INIT
// ==========================================
async function checkSession() {
    try {
        const { data: { session } } = await db.auth.getSession();
        if (!session) window.location.href = 'login.html';
        else { currentUser = session.user; loadData(); }
    } catch (e) { console.error("Session check:", e); }
}
checkSession();

document.getElementById('btn-logout')?.addEventListener('click', async () => {
    if(confirm("Logout?")) { await db.auth.signOut(); window.location.href = 'login.html'; }
});

// ==========================================
// 5. CORE LOGIC
// ==========================================
async function loadData() {
    showAlert('primary', 'Sinkronisasi data...');
    try {
        const marketReq = db.from('data_saham').select('*').order('kode_saham', { ascending: true }).limit(2000);
        const portfolioReq = db.from('portfolio').select('*');
        const [marketRes, portfolioRes] = await Promise.all([marketReq, portfolioReq]);

        if (marketRes.error) throw marketRes.error;
        allStocks = marketRes.data || [];
        myPortfolio = portfolioRes.data || [];
        applyFilterAndRender();
        if(allStocks.length > 0) showAlert('success', `Data siap: ${allStocks.length} Emiten.`);
        else showAlert('warning', 'Data kosong.');
    } catch (err) { showAlert('danger', 'Gagal load: ' + err.message); }
}

function applyFilterAndRender() {
    const processedData = allStocks.map(stock => {
        const owned = myPortfolio.find(p => p.kode_saham === stock.kode_saham);
        return analyzeStock(stock, owned);
    });

    renderMarketOverview(processedData);

    let filteredData = [];
    if (currentFilter === 'ALL') filteredData = processedData;
    else if (currentFilter === 'WATCHLIST') filteredData = processedData.filter(s => s.isWatchlist || s.isOwned);
    else if (currentFilter === 'OWNED') filteredData = processedData.filter(s => s.isOwned);
    renderTable(filteredData);
}

function analyzeStock(stock, ownedData) {
    const close = Number(stock.penutupan) || 0;
    const prev = Number(stock.sebelumnya) || close;
    const change = close - prev;
    const chgPercent = prev === 0 ? 0 : (change / prev) * 100;
    
    // Syariah (from CSV)
    let isSyariah = false;
    if (stock.syariah_flag && (stock.syariah_flag.toString().toLowerCase() === 'ya' || stock.syariah_flag === 'Y')) {
        isSyariah = true;
    }

    // Trends
    let trendLabel = '-';
    if (close > Number(stock.open_price) && chgPercent > 0) trendLabel = 'Bullish ↗️';
    else if (close < Number(stock.open_price) && chgPercent < 0) trendLabel = 'Bearish ↘️';

    const shares = Number(stock.listed_shares) || 0;
    const mcapVal = close * shares; 
    let mcapLabel = mcapVal >= 10000000000000 ? '🟦 BIG' : (mcapVal >= 1000000000000 ? '🟨 MID' : '⬜ SML');
    const netForeign = (Number(stock.foreign_buy) || 0) - (Number(stock.foreign_sell) || 0);

    let signal = chgPercent >= 1 ? 'BUY' : (chgPercent <= -1 ? 'SELL' : 'WAIT');
    let portfolioInfo = null, isOwned = false, isWatchlist = false;
    
    if (ownedData) {
        isWatchlist = ownedData.is_watchlist;
        if (ownedData.lots > 0) {
            isOwned = true;
            const avg = Number(ownedData.avg_price);
            const lots = Number(ownedData.lots);
            const plVal = (close * lots * 100) - (avg * lots * 100);
            const plPercent = (plVal / (avg * lots * 100)) * 100;
            let st = 'HOLD';
            const tpP = ownedData.tp_pct > 0 ? avg*(1+ownedData.tp_pct/100) : 0;
            const clP = ownedData.cl_pct > 0 ? avg*(1-ownedData.cl_pct/100) : 0;
            if(tpP>0 && close>=tpP) st='DONE TP 💰';
            else if(clP>0 && close<=clP) st='HIT CL ⚠️';
            else st = plPercent>0 ? 'HOLD 🟢' : 'HOLD 🔴';
            portfolioInfo = { avg, lots, tpPct: ownedData.tp_pct, clPct: ownedData.cl_pct, plPercent, status: st, notes: ownedData.notes };
        }
    }
    return { ...stock, change, chgPercent, signal, isOwned, isWatchlist, portfolio: portfolioInfo, mcapVal, mcapLabel, netForeign, is_syariah: isSyariah, trendLabel };
}

// ==========================================
// 6. RENDER UI (UPDATED: UNIFIED WIDGET)
// ==========================================
function calculateScore(stock) {
    let score = 0;
    const preset = localStorage.getItem('def_preset') || 'moderate';
    const chg = Number(stock.chgPercent)||0;
    const close = Number(stock.penutupan);
    const open = Number(stock.open_price);
    if(chg > 0) score += 10;
    if(close > open) score += 10; 

    if (preset === 'aggressive') { 
        if(chg > 2) score += 30; 
        if(Number(stock.frekuensi) > 5000) score += 30; else if(Number(stock.frekuensi) > 1000) score += 15;
    } else if (preset === 'conservative') {
        if(stock.mcapLabel === '🟦 BIG') score += 40; else if(stock.mcapLabel === '🟨 MID') score += 10;
        if((Number(stock.foreign_buy)-Number(stock.foreign_sell)) > 1e9) score += 30; 
    } else { 
        if(stock.mcapLabel !== '⬜ SML') score += 15; 
        if(Number(stock.frekuensi) > 2000) score += 15;
        if(chg > 1) score += 15;
        if((Number(stock.foreign_buy)-Number(stock.foreign_sell)) > 0) score += 15;
    }
    return score;
}

function renderMarketOverview(data) {
    const widgetArea = document.getElementById('market-overview-area');
    const listContainer = document.getElementById('market-list-container');
    const selectView = document.getElementById('market-view-select');
    
    if (!data || data.length === 0) { if(widgetArea) widgetArea.style.display = 'none'; return; }
    if(widgetArea) widgetArea.style.display = 'block';

    const view = selectView ? selectView.value : 'ai_picks';
    const fmtDec=(n)=>new Intl.NumberFormat('id-ID',{maximumFractionDigits:2}).format(n);
    const fmtShort=(n)=>{ if(Math.abs(n)>=1e12)return(n/1e12).toFixed(1)+' T'; if(Math.abs(n)>=1e9)return(n/1e9).toFixed(1)+' M'; return new Intl.NumberFormat('id-ID').format(n); };

    // PREPARE DATA BASED ON VIEW
    let sortedData = [];
    let valFunc = (s) => ''; 
    let colorFunc = (s) => 'text-dark';

    if (view === 'ai_picks') {
        // AI Logic
        sortedData = data.map(s=>({...s, score:calculateScore(s)})).sort((a,b)=>b.score-a.score);
        valFunc = (s) => `<span class="badge bg-success">Score: ${s.score}</span>`;
    } else if (view === 'gainers') {
        sortedData = [...data].sort((a,b)=>b.chgPercent-a.chgPercent);
        valFunc = (s) => `+${fmtDec(s.chgPercent)}%`; colorFunc = () => 'text-success';
    } else if (view === 'losers') {
        sortedData = [...data].sort((a,b)=>a.chgPercent-b.chgPercent);
        valFunc = (s) => `${fmtDec(s.chgPercent)}%`; colorFunc = () => 'text-danger';
    } else if (view === 'volume') {
        sortedData = [...data].sort((a,b)=>b.volume-a.volume);
        valFunc = (s) => fmtShort(s.volume);
    } else if (view === 'frequency') {
        sortedData = [...data].sort((a,b)=>(b.frekuensi||0)-(a.frekuensi||0));
        valFunc = (s) => fmtShort(s.frekuensi)+'x'; colorFunc = () => 'text-warning text-dark';
    } else if (view === 'foreign') {
        sortedData = data.filter(s=>s.netForeign>0).sort((a,b)=>b.netForeign-a.netForeign);
        valFunc = (s) => '+'+fmtShort(s.netForeign); colorFunc = () => 'text-info';
    } else if (view === 'mcap') {
        sortedData = [...data].sort((a,b)=>b.mcapVal-a.mcapVal);
        valFunc = (s) => fmtShort(s.mcapVal); colorFunc = () => 'text-primary';
    }

    // RENDER TOP 10 ONLY
    const top10 = sortedData.slice(0, 10);
    const html = top10.map(s => `
        <li class="list-group-item d-flex justify-content-between align-items-center py-2">
            <div class="d-flex align-items-center">
                <span class="fw-bold cursor-pointer text-primary me-2" onclick="openPortfolioModal('${s.kode_saham}')">${s.kode_saham}</span>
                <small class="text-muted" style="font-size:0.75em">${(s.nama_perusahaan||'').substring(0,15)}</small>
            </div>
            <span class="${colorFunc(s)} fw-bold" style="font-size:0.9em">${valFunc(s)}</span>
        </li>
    `).join('');

    if(listContainer) listContainer.innerHTML = html;
}

function renderTable(data) {
    const tbody = document.getElementById('table-body');
    const footer = document.getElementById('footer-info');
    if(!tbody) return;

    tbody.innerHTML = '';
    if (!data || data.length === 0) { if(footer) footer.innerText = "Tidak ada data."; return; }

    data.forEach(item => {
        try {
            const row = document.createElement('tr'); row.className = 'clickable-row'; 
            row.id = `row-${item.kode_saham}`; 
            
            const fmt = (n) => new Intl.NumberFormat('id-ID').format(Number(n)||0);
            const fmtDec = (n) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(Number(n)||0);
            const fmtShort = (n) => { if(Math.abs(n)>=1e12)return(n/1e12).toFixed(1)+' T'; if(Math.abs(n)>=1e9)return(n/1e9).toFixed(1)+' M'; return fmt(n); };

            const star = item.isWatchlist ? '<span class="text-warning star-btn me-2">★</span>' : '<span class="text-secondary star-btn me-2">☆</span>';
            const syr = item.is_syariah ? '<span class="badge bg-success ms-1" style="font-size:0.6em">S</span>' : '';
            
            const cell1 = `<td><div class="d-flex align-items-center"><span onclick="toggleWatchlist('${item.kode_saham}')">${star}</span><div><span class="fw-bold kode-saham-btn" onclick="openPortfolioModal('${item.kode_saham}')">${item.kode_saham}</span>${syr}<br><small class="text-muted" style="font-size:9px;">${(item.nama_perusahaan||'').substring(0,12)}</small></div></div></td>`;
            const cell2 = `<td>${fmt(item.penutupan)}</td>`;
            
            const asingColor = item.netForeign>0?'text-success':(item.netForeign<0?'text-danger':'text-muted');
            const cell3 = `<td class="text-end"><div><span class="badge bg-light text-dark border" style="font-size:9px;">${item.mcapLabel}</span></div><small class="${asingColor}" style="font-size:10px;">${item.netForeign!==0?fmtShort(item.netForeign):'-'}</small></td>`;
            
            const tColor = item.trendLabel.includes('Bullish')?'text-success':(item.trendLabel.includes('Bearish')?'text-danger':'text-muted');
            const cell4 = `<td class="text-center"><span class="${tColor} fw-bold" style="font-size:0.8rem">${item.trendLabel}</span></td>`;
            
            let metric='', badge='';
            if (currentFilter === 'OWNED' && item.isOwned && item.portfolio) {
                const pl = Number(item.portfolio.plPercent)||0;
                metric = `<div class="${pl>=0?'text-success':'text-danger'} fw-bold">${pl>=0?'+':''}${fmtDec(pl)}%</div>`;
                badge = `<span class="badge bg-secondary">${item.portfolio.status}</span>`;
            } else {
                metric = `<div class="${item.change>=0?'text-success':'text-danger'} fw-bold">${item.change>0?'+':''}${fmtDec(item.chgPercent)}%</div>`;
                badge = item.signal==='BUY'?`<span class="badge bg-success">BUY</span>`:(item.signal==='SELL'?`<span class="badge bg-danger">SELL</span>`:`<span class="badge bg-light text-secondary border">WAIT</span>`);
            }
            const cell5 = `<td class="text-end">${metric}</td>`;
            const cell6 = `<td class="text-center">${badge}</td>`;

            row.innerHTML = cell1 + cell2 + cell3 + cell4 + cell5 + cell6;
            tbody.appendChild(row);
        } catch(e){}
    });
    if(footer) footer.innerText = `Menampilkan ${data.length} saham.`;
}

// ==========================================
// 7. CHART ENGINE (LAZY LOADED)
// ==========================================
const calcSMA = (d, p) => d.length<p ? null : d.slice(d.length-p).reduce((a,b)=>a+b,0)/p;
const calcStdDev = (d, p) => { if(d.length<p)return 0; const s=d.slice(d.length-p); const m=s.reduce((a,b)=>a+b,0)/p; return Math.sqrt(s.map(x=>Math.pow(x-m,2)).reduce((a,b)=>a+b,0)/p); };
const calcStoch = (h, l, c, p) => { if(c.length<p)return null; const sl=l.slice(l.length-p), sh=h.slice(h.length-p); return ((c[c.length-1]-Math.min(...sl))/(Math.max(...sh)-Math.min(...sl)))*100; };
const calcBB = (prices, p, mult) => { if(prices.length < p) return null; const sma = calcSMA(prices, p); const sd = calcStdDev(prices, p); return { upper: sma + (mult*sd), lower: sma - (mult*sd), middle: sma }; };

async function loadAndRenderChart(kode) {
    const c1 = document.getElementById('price-chart');
    const c2 = document.getElementById('stoch-chart');
    if(c1) c1.innerHTML = '<div class="spinner-border text-primary m-5"></div>';
    if(c2) c2.innerHTML = '';

    const { data: h, error } = await db.from('history_saham').select('*').eq('kode_saham', kode).order('tanggal_perdagangan_terakhir', {ascending: true}).limit(300);
    
    if(error || !h || h.length < 50) { 
        if(c1) c1.innerHTML='<div class="d-flex align-items-center justify-content-center h-100 text-muted small">Data history belum cukup (< 50 hari).</div>'; 
        return; 
    }

    // Process Data
    const closes = h.map(x=>Number(x.penutupan)), highs = h.map(x=>Number(x.tertinggi)), lows = h.map(x=>Number(x.terendah));
    const dates = h.map(x=>new Date(x.tanggal_perdagangan_terakhir).getTime()), volumes = h.map(x=>Number(x.volume));

    const candleSeries = h.map(x => ({ x: new Date(x.tanggal_perdagangan_terakhir).getTime(), y: [x.open_price, x.tertinggi, x.terendah, x.penutupan] }));
    const bbUpper=[], bbLower=[], ma50=[], ma200=[], stochK=[];

    for(let i=0; i<h.length; i++) {
        const subC = closes.slice(0, i+1), subH = highs.slice(0, i+1), subL = lows.slice(0, i+1);
        if(i>=50) ma50.push({x:dates[i], y:calcSMA(subC, 50)});
        if(i>=200) ma200.push({x:dates[i], y:calcSMA(subC, 200)});
        if(i>=20) { const bb=calcBB(subC, 20, 2); if(bb) { bbUpper.push({x:dates[i], y:bb.upper}); bbLower.push({x:dates[i], y:bb.lower}); } }
        if(i>=14) stochK.push({x:dates[i], y:calcStoch(subH, subL, subC, 14)});
    }

    // Text Summary
    const lastC=closes[closes.length-1], lastH=highs[highs.length-1], lastL=lows[lows.length-1];
    const P=(lastH+lastL+lastC)/3;
    let obv=0; for(let i=1; i<closes.length; i++) obv += closes[i]>closes[i-1] ? volumes[i] : (closes[i]<closes[i-1]?-volumes[i]:0);
    let cross='-'; if(ma50.length>2 && ma200.length>2) {
        const c50=ma50[ma50.length-1].y, c200=ma200[ma200.length-1].y, p50=ma50[ma50.length-2].y, p200=ma200[ma200.length-2].y;
        if(p50<p200 && c50>c200) cross='GOLDEN CROSS 🚀'; else if(p50>p200 && c50<c200) cross='DEAD CROSS ☠️'; else cross = c50>c200?'Bullish':'Bearish';
    }

    const setT=(id,t)=>{const e=document.getElementById(id);if(e)e.innerText=t;};
    setT('tech-pivot', P.toFixed(0)); setT('tech-r1', (2*P-lastL).toFixed(0)); setT('tech-s1', (2*P-lastH).toFixed(0));
    setT('tech-obv', obv>0?'Akum (+)':'Dist (-)'); setT('tech-cross', cross);
    const lastK = stochK.length>0 ? stochK[stochK.length-1].y : 50;
    setT('tech-stoch', lastK>80?'Overbought 🔴':(lastK<20?'Oversold 🟢':'Netral'));

    // Render Charts
    if(c1) {
        if(priceChart) priceChart.destroy(); c1.innerHTML='';
        priceChart = new ApexCharts(c1, {
            series: [{name:'Harga',type:'candlestick',data:candleSeries},{name:'BB Up',type:'line',data:bbUpper},{name:'BB Low',type:'line',data:bbLower},{name:'MA50',type:'line',data:ma50},{name:'MA200',type:'line',data:ma200}],
            chart: {type:'line',height:250,toolbar:{show:false},animations:{enabled:false}},
            stroke: {width:[1,1,1,2,2], dashArray:[0,5,5,0,0]},
            colors: ['#000','#775DD0','#775DD0','#00E396','#FEB019'],
            xaxis: {type:'datetime',labels:{show:false}},
            yaxis: {labels:{formatter:(v)=>new Intl.NumberFormat('id-ID').format(v)}},
            grid: {padding:{bottom:0}}
        });
        priceChart.render();
    }
    if(c2) {
        if(stochChart) stochChart.destroy(); c2.innerHTML='';
        stochChart = new ApexCharts(c2, {
            series: [{name:'%K',data:stochK}],
            chart: {type:'line',height:120,toolbar:{show:false},animations:{enabled:false}},
            stroke: {width:2}, colors:['#008FFB'], xaxis:{type:'datetime'},
            yaxis: {max:100,min:0,tickAmount:2},
            annotations: {yaxis:[{y:20,borderColor:'#00E396'},{y:80,borderColor:'#FF4560'}]}
        });
        stochChart.render();
    }
}

// Helper: Form Calc
function updateCalc() {
    const elAvg=document.getElementById('input-avg'), elTp=document.getElementById('input-tp-pct'), elCl=document.getElementById('input-cl-pct');
    if(!elAvg) return;
    const avg=parseFloat(elAvg.value)||0, tpPct=parseFloat(elTp.value)||0, clPct=parseFloat(elCl.value)||0;
    document.getElementById('calc-tp').innerText = tpPct>0?`Rp ${new Intl.NumberFormat('id-ID').format(avg*(1+tpPct/100))}`:'-';
    document.getElementById('calc-cl').innerText = clPct>0?`Rp ${new Intl.NumberFormat('id-ID').format(avg*(1-clPct/100))}`:'-';
}
const inputs = ['input-avg','input-tp-pct','input-cl-pct'];
inputs.forEach(id=>{ const el=document.getElementById(id); if(el) el.addEventListener('input', updateCalc); });

// Helper: Form Submit
document.getElementById('portfolio-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if(!currentUser) return;
    portfolioModalInstance.hide();
    const payload = {
        user_id: currentUser.id,
        kode_saham: document.getElementById('input-kode').value,
        avg_price: document.getElementById('input-avg').value,
        lots: document.getElementById('input-lots').value,
        tp_pct: document.getElementById('input-tp-pct').value || 0,
        cl_pct: document.getElementById('input-cl-pct').value || 0,
        notes: document.getElementById('input-notes').value,
        is_watchlist: document.getElementById('input-watchlist').checked
    };
    const { error } = await db.from('portfolio').upsert(payload, { onConflict: 'user_id, kode_saham' });
    if (error) showAlert('danger', error.message); else { await loadData(); showAlert('success', 'Tersimpan!'); }
});

document.getElementById('strategy-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    localStorage.setItem('def_tp', document.getElementById('default-tp').value);
    localStorage.setItem('def_cl', document.getElementById('default-cl').value);
    localStorage.setItem('def_ma', document.getElementById('default-ma').value);
    localStorage.setItem('def_rsi', document.getElementById('default-rsi').value);
    localStorage.setItem('def_preset', document.getElementById('strategy-preset').value);
    strategyModalInstance.hide();
    showAlert('success', 'Strategi Tersimpan.');
    loadData(); // Reload to refresh AI Score
});

document.getElementById('btn-delete-portfolio')?.addEventListener('click', async () => {
    if(!confirm("Hapus?")) return;
    portfolioModalInstance.hide();
    const { error } = await db.from('portfolio').delete().match({ user_id: currentUser.id, kode_saham: document.getElementById('input-kode').value });
    if(!error) { await loadData(); showAlert('success', 'Dihapus.'); }
});

// CSV UPLOAD
const csvInput = document.getElementById('csv-file-input');
if (csvInput) {
    csvInput.addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (!file) return;
        showAlert('info', 'Parsing CSV...');
        Papa.parse(file, {
            header: true, skipEmptyLines: true,
            complete: async function(results) {
                const rawData = results.data;
                const formattedData = rawData.map(row => {
                    const getVal = (candidates) => { const key = Object.keys(row).find(k => candidates.some(c => c.toLowerCase() === k.trim().toLowerCase())); return key ? row[key] : null; };
                    const clean = (val) => { if (!val) return 0; if (typeof val === 'number') return val; let s = val.toString().replace(/,/g, '').trim(); if (s === '-' || s === '') return 0; return parseFloat(s) || 0; };
                    const kode = getVal(['Kode Saham', 'Kode', 'Code']);
                    if (!kode) return null;
                    return {
                        kode_saham: kode,
                        nama_perusahaan: getVal(['Nama Perusahaan', 'Nama']),
                        penutupan: clean(getVal(['Penutupan', 'Close'])),
                        sebelumnya: clean(getVal(['Sebelumnya', 'Previous'])),
                        open_price: clean(getVal(['Open Price', 'Open'])),
                        tertinggi: clean(getVal(['Tertinggi', 'High'])),
                        terendah: clean(getVal(['Terendah', 'Low'])),
                        volume: clean(getVal(['Volume'])),
                        nilai: clean(getVal(['Nilai', 'Value'])),
                        frekuensi: clean(getVal(['Frekuensi', 'Frequency'])),
                        foreign_sell: clean(getVal(['Foreign Sell'])),
                        foreign_buy: clean(getVal(['Foreign Buy'])),
                        listed_shares: clean(getVal(['Listed Shares'])),
                        tanggal_perdagangan_terakhir: getVal(['Tanggal Perdagangan Terakhir', 'Date']) || new Date().toISOString().split('T')[0]
                    };
                }).filter(item => item !== null);
                if (formattedData.length > 0) uploadToSupabase(formattedData); else showAlert('danger', 'Format CSV salah.');
            }
        });
    });
}

async function uploadToSupabase(dataSaham) {
    showAlert('warning', `Memproses...`);
    for (let i = 0; i < dataSaham.length; i += 50) {
        const { error } = await db.from('data_saham').upsert(dataSaham.slice(i, i + 50), { onConflict: 'kode_saham' });
    }
    const historyData = dataSaham.map(item => ({
        kode_saham: item.kode_saham,
        tanggal_perdagangan_terakhir: item.tanggal_perdagangan_terakhir,
        open_price: item.open_price,
        tertinggi: item.tertinggi,
        terendah: item.terendah,
        penutupan: item.penutupan,
        volume: item.volume,
        nilai: item.nilai,
        frekuensi: item.frekuensi,
        foreign_buy: item.foreign_buy,
        foreign_sell: item.foreign_sell
    }));
    for (let i = 0; i < historyData.length; i += 50) {
        const percent = Math.round((i / historyData.length) * 100);
        showAlert('warning', `Upload History: ${percent}% ...`);
        await db.from('history_saham').upsert(historyData.slice(i, i + 50), { onConflict: 'kode_saham, tanggal_perdagangan_terakhir' });
    }
    showAlert('success', 'Selesai!');
    setTimeout(loadData, 1500);
}

function showAlert(type, msg) {
    const box = document.getElementById('status-alert');
    if(box) { box.className = `alert alert-${type}`; box.innerHTML = msg; box.classList.remove('d-none'); }
}
