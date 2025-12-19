// ==========================================
// 1. KONFIGURASI SUPABASE
// ==========================================
const supabaseUrl = 'https://mbccvmalvbdxbornqtqc.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1iY2N2bWFsdmJkeGJvcm5xdHFjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU5MDc1MzEsImV4cCI6MjA4MTQ4MzUzMX0.FicPHqOtziJuac5OrNvTc9OG7CEK4Bn_G9F9CYR-N3s';
const db = supabase.createClient(supabaseUrl, supabaseKey);

// ==========================================
// 2. GLOBAL VARIABLES & AUTH
// ==========================================
let currentUser = null;
let allStocks = [];       
let myPortfolio = [];     
let currentFilter = 'ALL';
let priceChart = null; 
let stochChart = null; // Chart baru untuk Stochastic

// DEFINISI STRATEGI
const STRATEGIES = {
    'conservative': { tp: 15, cl: 7, ma: 50, rsi: 14, desc: "Swing (Santai). Indikator: MA 50" },
    'moderate':     { tp: 8,  cl: 4, ma: 20, rsi: 14, desc: "Day Trade. Indikator: MA 20" },
    'aggressive':   { tp: 3,  cl: 2, ma: 5,  rsi: 14, desc: "Scalping. Indikator: MA 5" }
};

// Inisialisasi Modal
let portfolioModal, strategyModal;
document.addEventListener('DOMContentLoaded', () => {
    try { 
        portfolioModal = new bootstrap.Modal(document.getElementById('portfolioModal')); 
        strategyModal = new bootstrap.Modal(document.getElementById('strategyModal'));
    } catch(e) {}
});

async function checkSession() {
    const { data: { session } } = await db.auth.getSession();
    if (!session) window.location.href = 'login.html';
    else { currentUser = session.user; loadData(); }
}
checkSession();

document.getElementById('btn-logout')?.addEventListener('click', async () => {
    if(confirm("Logout?")) { await db.auth.signOut(); window.location.href = 'login.html'; }
});

// ==========================================
// 3. LOAD DATA & SEARCH
// ==========================================
async function loadData() {
    showAlert('primary', 'Sinkronisasi data...');
    const marketReq = db.from('data_saham').select('*').order('kode_saham', { ascending: true }).limit(2000);
    const portfolioReq = db.from('portfolio').select('*');
    const [marketRes, portfolioRes] = await Promise.all([marketReq, portfolioReq]);

    if (marketRes.error) { showAlert('danger', 'Gagal load: ' + marketRes.error.message); return; }

    allStocks = marketRes.data;
    myPortfolio = portfolioRes.data || [];
    applyFilterAndRender();
    if(allStocks.length > 0) showAlert('success', `Data siap: ${allStocks.length} Emiten.`);
}

const searchInput = document.getElementById('input-search');
const searchResults = document.getElementById('search-results');
if(searchInput) {
    searchInput.addEventListener('input', (e) => {
        const val = e.target.value.toLowerCase().trim();
        if(val.length < 2) { searchResults.classList.add('d-none'); return; }
        const matches = allStocks.filter(s => 
            s.kode_saham.toLowerCase().includes(val) || 
            (s.nama_perusahaan && s.nama_perusahaan.toLowerCase().includes(val))
        ).slice(0, 10);
        if(matches.length > 0) {
            searchResults.innerHTML = matches.map(s => `
                <a href="#" class="list-group-item list-group-item-action" onclick="jumpToStock('${s.kode_saham}')">
                    <strong>${s.kode_saham}</strong> - <small>${s.nama_perusahaan}</small>
                </a>`).join('');
            searchResults.classList.remove('d-none');
        } else searchResults.classList.add('d-none');
    });
    document.addEventListener('click', (e) => {
        if (!searchInput.contains(e.target) && !searchResults.contains(e.target)) searchResults.classList.add('d-none');
    });
}
window.jumpToStock = (kode) => {
    document.getElementById('filter-all').click(); 
    searchResults.classList.add('d-none');
    searchInput.value = '';
    setTimeout(() => {
        const targetRow = document.getElementById(`row-${kode}`);
        if(targetRow) {
            targetRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
            targetRow.classList.add('highlight-search'); 
            setTimeout(() => targetRow.classList.remove('highlight-search'), 2000);
        } else alert("Saham tidak ditemukan.");
    }, 500); 
};

// ==========================================
// 4. ANALISA & FILTER
// ==========================================
function setFilter(type) { currentFilter = type; applyFilterAndRender(); }

function applyFilterAndRender() {
    const processedData = allStocks.map(stock => {
        const owned = myPortfolio.find(p => p.kode_saham === stock.kode_saham);
        return analyzeStock(stock, owned);
    });

    if(typeof renderMarketOverview === 'function') renderMarketOverview(processedData);

    let filteredData = [];
    if (currentFilter === 'ALL') filteredData = processedData;
    else if (currentFilter === 'SYARIAH') filteredData = processedData.filter(s => s.is_syariah);
    else if (currentFilter === 'WATCHLIST') filteredData = processedData.filter(s => s.isWatchlist || s.isOwned);
    else if (currentFilter === 'OWNED') filteredData = processedData.filter(s => s.isOwned);

    renderTable(filteredData);
}

function analyzeStock(stock, ownedData) {
    const close = Number(stock.penutupan) || 0;
    const prev = Number(stock.sebelumnya) || close;
    const change = close - prev;
    const chgPercent = prev === 0 ? 0 : (change / prev) * 100;
    
    // Syariah Check (Membaca kolom 'syariah_flag' yang nanti diisi dari CSV)
    let isSyariah = false;
    if (stock.syariah_flag && (stock.syariah_flag.toLowerCase() === 'ya' || stock.syariah_flag.toLowerCase() === 'yes' || stock.syariah_flag === 'Y')) {
        isSyariah = true;
    }

    // Tren Harian Simple
    let trendLabel = '-';
    if (close > Number(stock.open_price) && chgPercent > 0) trendLabel = 'Bullish ↗️';
    else if (close < Number(stock.open_price) && chgPercent < 0) trendLabel = 'Bearish ↘️';

    // Fundamental & Foreign
    const shares = Number(stock.listed_shares) || 0;
    const mcapVal = close * shares; 
    let mcapLabel = mcapVal >= 10000000000000 ? '🟦 BIG' : (mcapVal >= 1000000000000 ? '🟨 MID' : '⬜ SML');
    const fBuy = Number(stock.foreign_buy) || 0;
    const fSell = Number(stock.foreign_sell) || 0;
    const netForeign = fBuy - fSell;
    let foreignStatus = netForeign > 1000000000 ? 'Asing AKUM 🟢' : (netForeign < -1000000000 ? 'Asing DIST 🔴' : '-');

    let signal = 'WAIT';
    if (chgPercent >= 1) signal = 'BUY'; else if (chgPercent <= -1) signal = 'SELL';
    
    // Portfolio Logic
    let portfolioInfo = null, isOwned = false, isWatchlist = false;
    if (ownedData) {
        isWatchlist = ownedData.is_watchlist;
        if (ownedData.lots > 0) {
            isOwned = true;
            const avgPrice = Number(ownedData.avg_price);
            const lots = Number(ownedData.lots);
            const tpPct = Number(ownedData.tp_pct) || 0;
            const clPct = Number(ownedData.cl_pct) || 0;
            const tpPrice = tpPct > 0 ? avgPrice * (1 + (tpPct/100)) : 0;
            const clPrice = clPct > 0 ? avgPrice * (1 - (clPct/100)) : 0;
            const plVal = (close * lots * 100) - (avgPrice * lots * 100);
            const plPercent = (plVal / (avgPrice * lots * 100)) * 100;
            let actionStatus = 'HOLD';
            if (tpPrice > 0 && close >= tpPrice) actionStatus = 'DONE TP 💰';
            else if (clPrice > 0 && close <= clPrice) actionStatus = 'HIT CL ⚠️';
            else if (plPercent > 0) actionStatus = 'HOLD 🟢';
            else actionStatus = 'HOLD 🔴';
            if (plPercent > 2 && chgPercent > 0.5) signal = 'ADD-ON 🔥';
            portfolioInfo = { avg: avgPrice, lots, tpPct, clPct, tpPrice, clPrice, notes: ownedData.notes, plPercent, status: actionStatus };
        }
    }
    return { ...stock, change, chgPercent, signal, isOwned, isWatchlist, portfolio: portfolioInfo, mcapVal, mcapLabel, netForeign, foreignStatus, is_syariah: isSyariah, trendLabel };
}

// ==========================================
// 5. CHART ENGINE LENGKAP (BB, STOCH, ETC)
// ==========================================
// --- MATH HELPERS ---
const calcSMA = (data, p) => data.length<p ? null : data.slice(data.length-p).reduce((a,b)=>a+b,0)/p;
const calcStdDev = (data, p) => {
    if(data.length<p) return 0;
    const slice = data.slice(data.length-p);
    const mean = slice.reduce((a,b)=>a+b,0)/p;
    return Math.sqrt(slice.map(x=>Math.pow(x-mean,2)).reduce((a,b)=>a+b,0)/p);
};
const calcRSI = (prices, p=14) => {
    if(prices.length < p+1) return null;
    let gains=0, losses=0;
    for(let i=1; i<=p; i++) { const d=prices[i]-prices[i-1]; if(d>=0) gains+=d; else losses+=Math.abs(d); }
    let ag=gains/p, al=losses/p;
    for(let i=p+1; i<prices.length; i++) {
        const d=prices[i]-prices[i-1];
        ag=(ag*(p-1)+(d>=0?d:0))/p; al=(al*(p-1)+(d<0?Math.abs(d):0))/p;
    }
    return al===0?100 : 100-(100/(1+ag/al));
};
const calcBB = (prices, p=20, mult=2) => {
    if(prices.length < p) return null;
    const sma = calcSMA(prices, p);
    const sd = calcStdDev(prices, p);
    return { upper: sma + (mult*sd), lower: sma - (mult*sd), middle: sma };
};
const calcStoch = (highs, lows, closes, period=14) => {
    if(closes.length < period) return null;
    const c = closes[closes.length-1];
    const sliceL = lows.slice(lows.length-period);
    const sliceH = highs.slice(highs.length-period);
    const l = Math.min(...sliceL);
    const h = Math.max(...sliceH);
    return ((c - l) / (h - l)) * 100;
};

async function loadAndRenderChart(kode) {
    const c1 = document.getElementById('price-chart'); 
    const c2 = document.getElementById('stoch-chart'); 
    c1.innerHTML = '<div class="spinner-border text-primary m-5"></div>';
    c2.innerHTML = '';
    
    // FETCH 300 DATA UNTUK MA200
    const { data: h, error } = await db.from('history_saham').select('*').eq('kode_saham', kode)
        .order('tanggal_perdagangan_terakhir', {ascending: true}).limit(300);

    if(error || !h || h.length < 50) { c1.innerHTML='<small class="text-muted">Data history kurang (< 50 hari).</small>'; return; }

    const closes = h.map(x=>Number(x.penutupan));
    const highs = h.map(x=>Number(x.tertinggi));
    const lows = h.map(x=>Number(x.terendah));
    const dates = h.map(x=>new Date(x.tanggal_perdagangan_terakhir).getTime());
    const volumes = h.map(x=>Number(x.volume));

    // PREPARE SERIES
    const candleSeries = h.map(x => ({ x: new Date(x.tanggal_perdagangan_terakhir).getTime(), y: [x.open_price, x.tertinggi, x.terendah, x.penutupan] }));
    const bbUpper=[], bbLower=[], ma50=[], ma200=[], stochK=[]; 
    
    for(let i=0; i<h.length; i++) {
        const subC = closes.slice(0, i+1);
        const subH = highs.slice(0, i+1);
        const subL = lows.slice(0, i+1);
        
        if(i>=50) ma50.push({x:dates[i], y:calcSMA(subC, 50)});
        if(i>=200) ma200.push({x:dates[i], y:calcSMA(subC, 200)});
        if(i>=20) {
            const bb = calcBB(subC, 20, 2);
            if(bb) { bbUpper.push({x:dates[i], y:bb.upper}); bbLower.push({x:dates[i], y:bb.lower}); }
        }
        if(i>=14) stochK.push({x:dates[i], y:calcStoch(subH, subL, subC, 14)});
    }

    // ADVANCED SUMMARY
    const lastH = highs[highs.length-1], lastL = lows[lows.length-1], lastC = closes[closes.length-1];
    const P = (lastH + lastL + lastC) / 3;
    const R1 = (2*P) - lastL;
    const S1 = (2*P) - lastH;
    
    let obv = 0;
    for(let i=1; i<closes.length; i++) {
        if(closes[i] > closes[i-1]) obv += volumes[i];
        else if(closes[i] < closes[i-1]) obv -= volumes[i];
    }
    const obvStatus = obv > 0 ? "Akumulasi (+) 🟢" : "Distribusi (-) 🔴";

    let crossStatus = '-';
    if(ma50.length > 2 && ma200.length > 2) {
        const c50 = ma50[ma50.length-1].y, c200 = ma200[ma200.length-1].y;
        const p50 = ma50[ma50.length-2].y, p200 = ma200[ma200.length-2].y;
        if(p50 < p200 && c50 > c200) crossStatus = "GOLDEN CROSS 🚀";
        else if(p50 > p200 && c50 < c200) crossStatus = "DEAD CROSS ☠️";
        else crossStatus = c50 > c200 ? "Bullish (MA50>200)" : "Bearish (MA50<200)";
    }

    document.getElementById('tech-pivot').innerText = P.toFixed(0);
    document.getElementById('tech-r1').innerText = R1.toFixed(0);
    document.getElementById('tech-s1').innerText = S1.toFixed(0);
    document.getElementById('tech-obv').innerText = obvStatus;
    document.getElementById('tech-cross').innerText = crossStatus;
    const lastK = stochK.length>0 ? stochK[stochK.length-1].y : 50;
    document.getElementById('tech-stoch').innerText = lastK > 80 ? "Overbought 🔴" : (lastK < 20 ? "Oversold 🟢" : "Netral");

    // RENDER MAIN CHART
    if(priceChart) priceChart.destroy();
    c1.innerHTML='';
    priceChart = new ApexCharts(c1, {
        series: [
            { name: 'Harga', type: 'candlestick', data: candleSeries },
            { name: 'BB Up', type: 'line', data: bbUpper },
            { name: 'BB Low', type: 'line', data: bbLower },
            { name: 'MA 50', type: 'line', data: ma50 },
            { name: 'MA 200', type: 'line', data: ma200 }
        ],
        chart: { type: 'line', height: 250, toolbar:{show:false}, animations:{enabled:false} },
        stroke: { width: [1, 1, 1, 2, 2], curve: 'smooth', dashArray: [0, 5, 5, 0, 0] },
        colors: ['#000', '#775DD0', '#775DD0', '#00E396', '#FEB019'], 
        xaxis: { type: 'datetime', labels:{show:false} },
        yaxis: { labels: { formatter: (v)=>new Intl.NumberFormat('id-ID').format(v) } },
        grid: { padding:{bottom:0} }
    });
    priceChart.render();

    // RENDER SUB CHART
    if(stochChart) stochChart.destroy();
    c2.innerHTML='';
    stochChart = new ApexCharts(c2, {
        series: [{ name: '%K', data: stochK }],
        chart: { type: 'line', height: 120, toolbar:{show:false}, animations:{enabled:false} },
        stroke: { width: 2, curve: 'smooth' },
        colors: ['#008FFB'],
        xaxis: { type: 'datetime' },
        yaxis: { max: 100, min: 0, tickAmount: 2 },
        annotations: { yaxis: [{y: 20, borderColor: '#00E396', label:{text:'Oversold'}}, {y: 80, borderColor: '#FF4560', label:{text:'Overbought'}}] }
    });
    stochChart.render();
}

// ==========================================
// 6. RENDER TABLE & WIDGETS
// ==========================================
const tableBody = document.getElementById('table-body');
const footerInfo = document.getElementById('footer-info');

function renderTable(data) {
    tableBody.innerHTML = '';
    if (!data || data.length === 0) { footerInfo.innerText = "Tidak ada data."; return; }
    data.forEach(item => {
        try {
            const row = document.createElement('tr'); row.className = 'clickable-row'; row.id = `row-${item.kode_saham}`; 
            const fmt = (n) => new Intl.NumberFormat('id-ID').format(Number(n) || 0);
            const fmtDec = (n) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(Number(n) || 0);
            const fmtShort = (n) => { if(Math.abs(n)>=1e12)return(n/1e12).toFixed(1)+' T'; if(Math.abs(n)>=1e9)return(n/1e9).toFixed(1)+' M'; return fmt(n); };

            const syariahBadge = item.is_syariah ? '<span class="badge bg-success ms-1" style="font-size:0.6em">🕌</span>' : '';
            const starIcon = item.isWatchlist ? '★' : '☆';
            const starClass = item.isWatchlist ? 'text-warning' : 'text-secondary';
            
            const kodeHtml = `<div class="d-flex align-items-center"><span class="${starClass} star-btn me-2" onclick="toggleWatchlist('${item.kode_saham}')">${starIcon}</span><div><span class="fw-bold kode-saham-btn" onclick="openPortfolioModal('${item.kode_saham}')">${item.kode_saham}</span>${syariahBadge}<br><small class="text-muted" style="font-size:9px;">${(item.nama_perusahaan||'').substring(0,12)}</small></div></div>`;
            const asingColor = item.netForeign>0?'text-success':(item.netForeign<0?'text-danger':'text-muted');
            const fundHtml = `<div><span class="badge bg-light text-dark border" style="font-size:9px;">${item.mcapLabel}</span></div><small class="${asingColor}" style="font-size:10px;">${item.netForeign!==0?fmtShort(item.netForeign):'-'}</small>`;
            const trendColor = item.trendLabel.includes('Bullish')?'text-success':(item.trendLabel.includes('Bearish')?'text-danger':'text-muted');
            const trendHtml = `<span class="${trendColor} fw-bold" style="font-size:0.8rem">${item.trendLabel}</span>`;
            
            let metric='', badge='';
            if (currentFilter === 'OWNED' && item.isOwned && item.portfolio) {
                const pl=Number(item.portfolio.plPercent)||0; metric=`<div class="${pl>=0?'text-success':'text-danger'} fw-bold">${pl>=0?'+':''}${fmtDec(pl)}%</div>`; badge=`<span class="badge bg-secondary">${item.portfolio.status}</span>`;
            } else {
                metric=`<div class="${item.change>=0?'text-success':'text-danger'} fw-bold">${item.change>0?'+':''}${fmtDec(item.chgPercent)}%</div>`;
                badge = item.signal==='BUY'?`<span class="badge bg-success">BUY</span>`:(item.signal==='SELL'?`<span class="badge bg-danger">SELL</span>`:`<span class="badge bg-light text-secondary border">WAIT</span>`);
            }
            row.innerHTML = `<td>${kodeHtml}</td><td>${fmt(item.penutupan)}</td><td class="text-end">${fundHtml}</td><td class="text-center">${trendHtml}</td><td class="text-end">${metric}</td><td class="text-center">${badge}</td>`;
            tableBody.appendChild(row);
        } catch (e){}
    });
    footerInfo.innerText = `Menampilkan ${data.length} saham.`;
}

// Widget & AI Score
window.toggleExpand = (id, btn) => {
    const el = document.getElementById(id);
    if(el.classList.contains('d-none')) { el.classList.remove('d-none'); btn.innerHTML='Tutup ⌃'; } else { el.classList.add('d-none'); btn.innerHTML='Lihat Lainnya ⌄'; }
};

function calculateScore(stock) {
    let score = 0;
    if((Number(stock.chgPercent)||0) > 0.5) score += 20; else if((Number(stock.chgPercent)||0) > 0) score += 10;
    if(Number(stock.penutupan) > Number(stock.open_price)) score += 10;
    const netF = (Number(stock.foreign_buy)||0) - (Number(stock.foreign_sell)||0);
    if(netF > 5e9) score += 30; else if(netF > 1e9) score += 20; else if(netF > 0) score += 10;
    const freq = Number(stock.frekuensi)||0; if(freq>5000) score += 15; else if(freq>1000) score += 10;
    if((Number(stock.penutupan)*(Number(stock.listed_shares)||0)) >= 1e12) score += 15;
    if(stock.is_syariah) score += 10; 
    return score;
}

function renderMarketOverview(data) {
    const w = document.getElementById('market-overview-area');
    if (!data || data.length === 0) { if(w) w.style.display = 'none'; return; }
    if(w) w.style.display = 'flex';
    document.getElementById('tech-recommendation-area').style.display='flex';

    const fmt=(n)=>new Intl.NumberFormat('id-ID').format(n);
    const fmtDec=(n)=>new Intl.NumberFormat('id-ID',{maximumFractionDigits:2}).format(n);
    const fmtShort=(n)=>{ if(Math.abs(n)>=1e12)return(n/1e12).toFixed(1)+' T'; if(Math.abs(n)>=1e9)return(n/1e9).toFixed(1)+' M'; return fmt(n); };
    const createItem=(s,v,c)=>`<li class="list-group-item d-flex justify-content-between align-items-center py-1"><span class="fw-bold cursor-pointer text-primary" onclick="openPortfolioModal('${s.kode_saham}')">${s.kode_saham}</span><span class="${c} fw-bold" style="font-size:0.85em">${v}</span></li>`;
    const renderBox = (arr, id, vf, cf) => {
        const t5=arr.slice(0,5), n15=arr.slice(5,20);
        let h = t5.map(s=>createItem(s,vf(s),cf(s))).join('');
        if(n15.length>0) h+=`<div id="${id}-hidden" class="d-none border-top mt-1 pt-1">${n15.map(s=>createItem(s,vf(s),cf(s))).join('')}</div>`;
        document.getElementById(id).innerHTML = h;
    };

    renderBox([...data].sort((a,b)=>b.chgPercent-a.chgPercent), 'list-gainers', s=>`+${fmtDec(s.chgPercent)}%`, ()=>'text-success');
    renderBox([...data].sort((a,b)=>a.chgPercent-b.chgPercent), 'list-losers', s=>`${fmtDec(s.chgPercent)}%`, ()=>'text-dange