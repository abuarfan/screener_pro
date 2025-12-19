// ==========================================
// 1. KONFIGURASI SUPABASE
// ==========================================
const supabaseUrl = 'https://mbccvmalvbdxbornqtqc.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1iY2N2bWFsdmJkeGJvcm5xdHFjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU5MDc1MzEsImV4cCI6MjA4MTQ4MzUzMX0.FicPHqOtziJuac5OrNvTc9OG7CEK4Bn_G9F9CYR-N3s';
const db = supabase.createClient(supabaseUrl, supabaseKey);

// ==========================================
// 2. GLOBAL VARIABLES
// ==========================================
let currentUser = null, allStocks = [], myPortfolio = [], currentFilter = 'ALL';
let priceChart = null, stochChart = null;

const STRATEGIES = {
    'conservative': { tp: 15, cl: 7, ma: 50, rsi: 14, desc: "Swing (Santai). Fokus: Big Cap & Trend." },
    'moderate':     { tp: 8,  cl: 4, ma: 20, rsi: 14, desc: "Day Trade. Fokus: Balanced." },
    'aggressive':   { tp: 3,  cl: 2, ma: 5,  rsi: 14, desc: "Scalping. Fokus: Volatility & Volume." }
};

// Modal Init
let portfolioModal, strategyModal;
document.addEventListener('DOMContentLoaded', () => {
    try { 
        const elPort = document.getElementById('portfolioModal'); if(elPort) portfolioModal = new bootstrap.Modal(elPort); 
        const elStrat = document.getElementById('strategyModal'); if(elStrat) strategyModal = new bootstrap.Modal(elStrat);
    } catch(e) {}
});

async function checkSession() {
    try {
        const { data: { session } } = await db.auth.getSession();
        if (!session) window.location.href = 'login.html'; else { currentUser = session.user; loadData(); }
    } catch (e) { console.error(e); }
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
    try {
        const marketReq = db.from('data_saham').select('*').order('kode_saham', { ascending: true }).limit(2000);
        const portfolioReq = db.from('portfolio').select('*');
        const [marketRes, portfolioRes] = await Promise.all([marketReq, portfolioReq]);
        if (marketRes.error) throw marketRes.error;

        allStocks = marketRes.data || [];
        myPortfolio = portfolioRes.data || [];
        applyFilterAndRender();
        if(allStocks.length > 0) showAlert('success', `Data siap: ${allStocks.length} Emiten.`);
    } catch (err) { showAlert('danger', 'Error: ' + err.message); }
}

const searchInput = document.getElementById('input-search');
const searchResults = document.getElementById('search-results');
if(searchInput) {
    searchInput.addEventListener('input', (e) => {
        const val = e.target.value.toLowerCase().trim();
        if(val.length < 2) { searchResults.classList.add('d-none'); return; }
        const matches = allStocks.filter(s => s.kode_saham.toLowerCase().includes(val) || (s.nama_perusahaan||'').toLowerCase().includes(val)).slice(0, 10);
        if(matches.length > 0) {
            searchResults.innerHTML = matches.map(s => `<a href="#" class="list-group-item list-group-item-action" onclick="jumpToStock('${s.kode_saham}')"><strong>${s.kode_saham}</strong> - <small>${s.nama_perusahaan}</small></a>`).join('');
            searchResults.classList.remove('d-none');
        } else searchResults.classList.add('d-none');
    });
    document.addEventListener('click', (e) => { if(!searchInput.contains(e.target)) searchResults.classList.add('d-none'); });
}
window.jumpToStock = (kode) => {
    document.getElementById('filter-all').click(); searchResults.classList.add('d-none'); searchInput.value = '';
    setTimeout(() => {
        const row = document.getElementById(`row-${kode}`);
        if(row) { row.scrollIntoView({block:'center'}); row.classList.add('highlight-search'); setTimeout(()=>row.classList.remove('highlight-search'), 2000); }
    }, 500); 
};

// ==========================================
// 4. ANALISA & FILTER (SYARIAH REMOVED)
// ==========================================
function setFilter(type) { currentFilter = type; applyFilterAndRender(); }
function applyFilterAndRender() {
    const processed = allStocks.map(s => analyzeStock(s, myPortfolio.find(p => p.kode_saham === s.kode_saham)));
    if(typeof renderMarketOverview === 'function') renderMarketOverview(processed);
    
    let filtered = processed;
    if (currentFilter === 'WATCHLIST') filtered = processed.filter(s => s.isWatchlist || s.isOwned);
    else if (currentFilter === 'OWNED') filtered = processed.filter(s => s.isOwned);
    renderTable(filtered);
}

function analyzeStock(stock, owned) {
    const close = Number(stock.penutupan)||0, prev = Number(stock.sebelumnya)||close;
    const change = close - prev, chgPercent = prev===0?0:(change/prev)*100;
    
    // Trend Harian Simple
    let trendLabel = '-';
    if(close > Number(stock.open_price) && chgPercent > 0) trendLabel = 'Bullish ↗️';
    else if(close < Number(stock.open_price) && chgPercent < 0) trendLabel = 'Bearish ↘️';

    // Mcap & Foreign
    const mcap = close * (Number(stock.listed_shares)||0);
    const mcapLabel = mcap>=10000000000000?'🟦 BIG':(mcap>=1000000000000?'🟨 MID':'⬜ SML');
    const netF = (Number(stock.foreign_buy)||0) - (Number(stock.foreign_sell)||0);
    const foreignStatus = netF > 1e9 ? 'Asing AKUM 🟢' : (netF < -1e9 ? 'Asing DIST 🔴' : '-');

    let signal = chgPercent >= 1 ? 'BUY' : (chgPercent <= -1 ? 'SELL' : 'WAIT');
    let port = null;
    if(owned && owned.lots > 0) {
        const avg = Number(owned.avg_price), lots = Number(owned.lots);
        const tp = owned.tp_pct>0 ? avg*(1+owned.tp_pct/100) : 0;
        const cl = owned.cl_pct>0 ? avg*(1-owned.cl_pct/100) : 0;
        const plPct = ((close*lots*100)-(avg*lots*100))/(avg*lots*100)*100;
        let st = 'HOLD';
        if(tp>0 && close>=tp) st='DONE TP 💰'; else if(cl>0 && close<=cl) st='HIT CL ⚠️';
        else st = plPct>0 ? 'HOLD 🟢' : 'HOLD 🔴';
        if(plPct>2 && chgPercent>0.5) signal = 'ADD-ON 🔥';
        port = { avg, lots, tpPct: owned.tp_pct, clPct: owned.cl_pct, tp, cl, notes: owned.notes, plPercent: plPct, status: st };
    }
    return { ...stock, change, chgPercent, signal, isOwned: !!port, isWatchlist: owned?.is_watchlist, portfolio: port, mcapVal: mcap, mcapLabel, netForeign: netF, foreignStatus, trendLabel };
}

// ==========================================
// 5. CHART ENGINE LENGKAP
// ==========================================
const calcSMA = (d, p) => d.length<p ? null : d.slice(d.length-p).reduce((a,b)=>a+b,0)/p;
const calcStdDev = (d, p) => { if(d.length<p)return 0; const s=d.slice(d.length-p); const m=s.reduce((a,b)=>a+b,0)/p; return Math.sqrt(s.map(x=>Math.pow(x-m,2)).reduce((a,b)=>a+b,0)/p); };
const calcStoch = (h, l, c, p) => { if(c.length<p)return null; const sl=l.slice(l.length-p), sh=h.slice(h.length-p); return ((c[c.length-1]-Math.min(...sl))/(Math.max(...sh)-Math.min(...sl)))*100; };

async function loadAndRenderChart(kode) {
    const c1 = document.getElementById('price-chart'), c2 = document.getElementById('stoch-chart'); 
    if(c1) c1.innerHTML = '<div class="spinner-border text-primary m-5"></div>'; if(c2) c2.innerHTML = '';
    
    const { data: h, error } = await db.from('history_saham').select('*').eq('kode_saham', kode).order('tanggal_perdagangan_terakhir', {ascending: true}).limit(300);
    if(error || !h || h.length < 50) { if(c1) c1.innerHTML='<small class="text-muted">Data history kurang.</small>'; return; }

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

    // Tech Summary
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

    if(c1) {
        if(priceChart) priceChart.destroy(); c1.innerHTML='';
        priceChart = new ApexCharts(c1, { series: [{name:'Harga',type:'candlestick',data:candleSeries},{name:'BB Up',type:'line',data:bbUpper},{name:'BB Low',type:'line',data:bbLower},{name:'MA50',type:'line',data:ma50},{name:'MA200',type:'line',data:ma200}], chart:{type:'line',height:250,toolbar:{show:false}}, stroke:{width:[1,1,1,2,2], dashArray:[0,5,5,0,0]}, colors:['#000','#775DD0','#775DD0','#00E396','#FEB019'], xaxis:{type:'datetime',labels:{show:false}}, yaxis:{labels:{formatter:(v)=>new Intl.NumberFormat('id-ID').format(v)}}, grid:{padding:{bottom:0}} });
        priceChart.render();
    }
    if(c2) {
        if(stochChart) stochChart.destroy(); c2.innerHTML='';
        stochChart = new ApexCharts(c2, { series:[{name:'%K',data:stochK}], chart:{type:'line',height:120,toolbar:{show:false}}, stroke:{width:2}, colors:['#008FFB'], xaxis:{type:'datetime'}, yaxis:{max:100,min:0,tickAmount:2}, annotations:{yaxis:[{y:20,borderColor:'#00E396'},{y:80,borderColor:'#FF4560'}]} });
        stochChart.render();
    }
}
// BB Helper reused inside loadAndRenderChart
function calcBB(prices, p, mult) {
    if(prices.length < p) return null;
    const sma = calcSMA(prices, p); const sd = calcStdDev(prices, p);
    return { upper: sma + (mult*sd), lower: sma - (mult*sd), middle: sma };
}

// ==========================================
// 6. RENDER TABLE & DYNAMIC SCORE
// ==========================================
const tableBody = document.getElementById('table-body');
const footerInfo = document.getElementById('footer-info');

function calculateScore(stock) {
    let score = 0;
    // Ambil Strategi Aktif
    const preset = localStorage.getItem('def_preset') || 'moderate';
    
    // 1. Momentum & Harga (Universal)
    const chg = Number(stock.chgPercent)||0;
    const close = Number(stock.penutupan);
    const open = Number(stock.open_price);
    if(chg > 0) score += 10;
    if(close > open) score += 10; // Candle Hijau

    // 2. Logic Berdasarkan Strategi
    if (preset === 'aggressive') { 
        // SCALPING: Butuh Volatilitas & Frekuensi Tinggi
        if(chg > 2) score += 30; // Harga gerak kencang
        if(Number(stock.frekuensi) > 5000) score += 30; // Sangat Rame
        else if(Number(stock.frekuensi) > 1000) score += 15;
    } 
    else if (preset === 'conservative') {
        // INVESTING: Butuh Big Cap & Foreign Flow
        if(stock.mcapLabel === '🟦 BIG') score += 40; // Wajib Bluechip
        else if(stock.mcapLabel === '🟨 MID') score += 10;
        if((Number(stock.foreign_buy)-Number(stock.foreign_sell)) > 1e9) score += 30; // Asing Akumulasi
    } 
    else { 
        // MODERATE: Seimbang
        if(stock.mcapLabel !== '⬜ SML') score += 15; // Hindari gorengan murni
        if(Number(stock.frekuensi) > 2000) score += 15;
        if(chg > 1) score += 15;
        const netF = Number(stock.foreign_buy)-Number(stock.foreign_sell);
        if(netF > 0) score += 15;
    }

    return score;
}

function renderMarketOverview(data) {
    const w = document.getElementById('market-overview-area');
    // Update Badge Strategi
    const elBadge = document.getElementById('ai-strategy-badge');
    if(elBadge) {
        const strat = localStorage.getItem('def_preset') || 'moderate';
        elBadge.innerText = `Strategy: ${strat.charAt(0).toUpperCase() + strat.slice(1)}`;
    }

    if (!data || data.length === 0) { if(w) w.style.display = 'none'; return; }
    if(w) w.style.display = 'flex';
    document.getElementById('tech-recommendation-area').style.display='flex';

    const fmt=(n)=>new Intl.NumberFormat('id-ID').format(n);
    const fmtDec=(n)=>new Intl.NumberFormat('id-ID',{maximumFractionDigits:2}).format(n);
    const fmtShort=(n)=>{ if(Math.abs(n)>=1e12)return(n/1e12).toFixed(1)+' T'; if(Math.abs(n)>=1e9)return(n/1e9).toFixed(1)+' M'; return fmt(n); };
    const createItem=(s,v,c)=>`<li class="list-group-item d-flex justify-content-between align-items-center py-1 bg-transparent"><span class="fw-bold cursor-pointer text-primary" onclick="openPortfolioModal('${s.kode_saham}')">${s.kode_saham}</span><span class="${c} fw-bold" style="font-size:0.85em">${v}</span></li>`;
    const renderBox = (arr, id, vf, cf) => {
        const el = document.getElementById(id); if(!el) return;
        const t5=arr.slice(0,5), n15=arr.slice(5,20);
        let h = t5.map(s=>createItem(s,vf(s),cf(s))).join('');
        if(n15.length>0) h+=`<div id="${id}-hidden" class="d-none border-top mt-1 pt-1">${n15.map(s=>createItem(s,vf(s),cf(s))).join('')}</div>`;
        el.innerHTML = h;
    };

    renderBox([...data].sort((a,b)=>b.chgPercent-a.chgPercent), 'list-gainers', s=>`+${fmtDec(s.chgPercent)}%`, ()=>'text-success');
    renderBox([...data].sort((a,b)=>a.chgPercent-b.chgPercent), 'list-losers', s=>`${fmtDec(s.chgPercent)}%`, ()=>'text-danger');
    renderBox([...data].sort((a,b)=>b.volume-a.volume), 'list-volume', s=>fmt(s.volume), ()=>'text-dark');
    renderBox([...data].sort((a,b)=>b.mcapVal-a.mcapVal), 'list-mcap', s=>fmtShort(s.mcapVal), ()=>'text-primary');
    renderBox(data.filter(s=>s.netForeign>0).sort((a,b)=>b.netForeign-a.netForeign), 'list-foreign', s=>'+'+fmtShort(s.netForeign), ()=>'text-info');
    renderBox([...data].sort((a,b)=>(b.frekuensi||0)-(a.frekuensi||0)), 'list-freq', s=>fmt(s.frekuensi)+'x', ()=>'text-warning text-dark');

    // AI Score (Dynamic)
    const elTop = document.getElementById('list-worth-buy-top');
    if(elTop) {
        const scored = data.map(s=>({...s, score:calculateScore(s)})).sort((a,b)=>b.score-a.score).slice(0,20);
        elTop.innerHTML = scored.slice(0,5).map(s=>`
            <div class="col py-2 text-center border-end">
                <span class="d-block fw-bold text-dark cursor-pointer" onclick="openPortfolioModal('${s.kode_saham}')">${s.kode_saham}</span>
                <span class="badge bg-success mb-1" style="font-size:0.7em">Score: ${s.score}</span>
                <br><span class="text-success small fw-bold">+${fmtDec(s.chgPercent)}%</span>
            </div>`).join('');
        const elHid = document.getElementById('ul-worth-buy-hidden');
        if(elHid) elHid.innerHTML = scored.slice(5,20).map(s=>`<li class="list-group-item d-flex justify-content-between align-items-center py-1 bg-light"><div><span class="fw-bold cursor-pointer text-primary" onclick="openPortfolioModal('${s.kode_saham}')">${s.kode_saham}</span><span class="badge bg-secondary ms-2" style="font-size:0.7em">Score: ${s.score}</span></div><span class="text-success fw-bold" style="font-size:0.85em">+${fmtDec(s.chgPercent)}%</span></li>`).join('');
    }
}

function renderTable(data) {
    if(!tableBody || !footerInfo) return;
    tableBody.innerHTML = '';
    if (!data || data.length === 0) { footerInfo.innerText = "Tidak ada data."; return; }
    
    data.forEach(item => {
        try {
            const row = document.createElement('tr'); row.className = 'clickable-row'; row.id = `row-${item.kode_saham}`; 
            const fmt = (n) => new Intl.NumberFormat('id-ID').format(Number(n) || 0);
            const fmtDec = (n) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(Number(n) || 0);
            const fmtShort = (n) => { if(Math.abs(n)>=1e12)return(n/1e12).toFixed(1)+' T'; if(Math.abs(n)>=1e9)return(n/1e9).toFixed(1)+' M'; return fmt(n); };

            const starIcon = item.isWatchlist ? '★' : '☆';
            const starClass = item.isWatchlist ? 'text-warning' : 'text-secondary';
            
            const kodeHtml = `<div class="d-flex align-items-center"><span class="${starClass} star-btn me-2" onclick="toggleWatchlist('${item.kode_saham}')">${starIcon}</span><div><span class="fw-bold kode-saham-btn" onclick="openPortfolioModal('${item.kode_saham}')">${item.kode_saham}</span><br><small class="text-muted" style="font-size:9px;">${(item.nama_perusahaan||'').substring(0,12)}</small></div></div>`;
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

window.toggleExpand = (id, btn) => {
    const el = document.getElementById(id);
    if(!el) return;
    if(el.classList.contains('d-none')) { el.classList.remove('d-none'); btn.innerHTML='Tutup ⌃'; } else { el.classList.add('d-none'); btn.innerHTML='Lihat Lainnya ⌄'; }
};

// ... (CSV UPLOAD CODE TETAP SAMA SEPERTI SEBELUMNYA) ...
// Copas fungsi uploadToSupabase dan event listener csv-file-input dari file lama jika perlu,
// atau gunakan yang ada di bawah ini agar lengkap.

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
                    const getVal = (candidates) => {
                        const key = Object.keys(row).find(k => candidates.some(c => c.toLowerCase() === k.trim().toLowerCase()));
                        return key ? row[key] : null;
                    };
                    const clean = (val) => {
                        if (!val) return 0;
                        if (typeof val === 'number') return val;
                        let s = val.toString().replace(/,/g, '').trim(); 
                        if (s === '-' || s === '') return 0;
                        return parseFloat(s) || 0;
                    };
                    const kode = getVal(['Kode Saham', 'Kode', 'Code']);
                    if (!kode) return null;
                    return {
                        kode_saham: kode,
                        nama_perusahaan: getVal(['Nama Perusahaan', 'Nama']),
                        remarks: getVal(['Remarks']),
                        no: parseInt(getVal(['No'])) || null,
                        penutupan: clean(getVal(['Penutupan', 'Close'])),
                        sebelumnya: clean(getVal(['Sebelumnya', 'Previous'])),
                        open_price: clean(getVal(['Open Price', 'Open'])),
                        tertinggi: clean(getVal(['Tertinggi', 'High'])),
                        terendah: clean(getVal(['Terendah', 'Low'])),
                        first_trade: clean(getVal(['First Trade'])),
                        selisih: clean(getVal(['Selisih', 'Change'])),
                        volume: clean(getVal(['Volume'])),
                        nilai: clean(getVal(['Nilai', 'Value'])),
                        frekuensi: clean(getVal(['Frekuensi', 'Frequency'])),
                        foreign_sell: clean(getVal(['Foreign Sell'])),
                        foreign_buy: clean(getVal(['Foreign Buy'])),
                        listed_shares: clean(getVal(['Listed Shares'])),
                        tanggal_perdagangan_terakhir: getVal(['Tanggal Perdagangan Terakhir', 'Date']) || new Date().toISOString().split('T')[0]
                    };
                }).filter(item => item !== null);
                if (formattedData.length > 0) uploadToSupabase(formattedData);
                else showAlert('danger', 'Format CSV tidak dikenali.');
            }
        });
    });
}

async function uploadToSupabase(dataSaham) {
    showAlert('warning', `Memproses Data...`);
    const batchSize = 50; 
    let errorCount = 0; 

    // Update Data Harian
    for (let i = 0; i < dataSaham.length; i += batchSize) {
        const batch = dataSaham.slice(i, i + batchSize);
        const percent = Math.round((i / dataSaham.length) * 50);
        showAlert('warning', `Update Pasar: ${percent}% ...`);
        const { error } = await db.from('data_saham').upsert(batch, { onConflict: 'kode_saham' });
        if (error) errorCount++;
    }
    
    // Update History
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
    for (let i = 0; i < historyData.length; i += batchSize) {
        const batch = historyData.slice(i, i + batchSize);
        const percent = 50 + Math.round((i / historyData.length) * 50);
        showAlert('warning', `Arsip History: ${percent}% ...`);
        const { error } = await db.from('history_saham').upsert(batch, { onConflict: 'kode_saham, tanggal_perdagangan_terakhir' });
        if (error) errorCount++;
    }

    if (errorCount === 0) {
        showAlert('success', 'SUKSES! Data diproses.');
        if(csvInput) csvInput.value = '';
        setTimeout(loadData, 2000);
    } else {
        showAlert('danger', `Selesai dengan error.`);
    }
}

function showAlert(type, msg) {
    const alertBox = document.getElementById('status-alert');
    if(alertBox) {
        alertBox.className = `alert alert-${type}`;
        alertBox.innerHTML = msg;
        alertBox.classList.remove('d-none');
    }
}
