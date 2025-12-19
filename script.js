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

// --- DEFINISI STRATEGI (Updated dengan RSI & MA) ---
const STRATEGIES = {
    'conservative': { tp: 15, cl: 7, ma: 50, rsi: 14, desc: "Fokus jangka panjang. Menggunakan MA 50 untuk melihat tren besar." },
    'moderate':     { tp: 8,  cl: 4, ma: 20, rsi: 14, desc: "Seimbang. Menggunakan MA 20 (Bollinger middle) sebagai acuan." },
    'aggressive':   { tp: 3,  cl: 2, ma: 5,  rsi: 14, desc: "Cepat keluar masuk. Menggunakan MA 5 untuk menangkap tren sesaat." }
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
// 3. LOAD DATA
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

// ==========================================
// 4. SEARCH FUNCTIONALITY
// ==========================================
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
// 5. ANALISA & FILTER
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
    else if (currentFilter === 'WATCHLIST') filteredData = processedData.filter(s => s.isWatchlist || s.isOwned);
    else if (currentFilter === 'OWNED') filteredData = processedData.filter(s => s.isOwned);
    renderTable(filteredData);
}

function analyzeStock(stock, ownedData) {
    const close = Number(stock.penutupan) || 0;
    const prev = Number(stock.sebelumnya) || close;
    const change = close - prev;
    const chgPercent = prev === 0 ? 0 : (change / prev) * 100;
    const shares = Number(stock.listed_shares) || 0;
    const mcapVal = close * shares; 
    let mcapLabel = mcapVal >= 10000000000000 ? '🟦 BIG' : (mcapVal >= 1000000000000 ? '🟨 MID' : '⬜ SML');
    const fBuy = Number(stock.foreign_buy) || 0;
    const fSell = Number(stock.foreign_sell) || 0;
    const netForeign = fBuy - fSell;
    let foreignStatus = netForeign > 1000000000 ? 'Asing AKUM 🟢' : (netForeign < -1000000000 ? 'Asing DIST 🔴' : '-');

    let signal = 'WAIT';
    if (chgPercent >= 1) signal = 'BUY'; else if (chgPercent <= -1) signal = 'SELL';
    
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
            const marketVal = close * lots * 100; 
            const buyVal = avgPrice * lots * 100;
            const plVal = marketVal - buyVal;
            const plPercent = (plVal / buyVal) * 100;
            let actionStatus = 'HOLD';
            if (tpPrice > 0 && close >= tpPrice) actionStatus = 'DONE TP 💰';
            else if (clPrice > 0 && close <= clPrice) actionStatus = 'HIT CL ⚠️';
            else if (plPercent > 0) actionStatus = 'HOLD 🟢';
            else actionStatus = 'HOLD 🔴';
            if (plPercent > 2 && chgPercent > 0.5) signal = 'ADD-ON 🔥';
            portfolioInfo = { avg: avgPrice, lots, tpPct, clPct, tpPrice, clPrice, notes: ownedData.notes, plPercent, status: actionStatus };
        }
    }
    return { ...stock, change, chgPercent, signal, isOwned, isWatchlist, portfolio: portfolioInfo, mcapVal, mcapLabel, netForeign, foreignStatus };
}

// ==========================================
// 6. RENDER TABLE
// ==========================================
const tableBody = document.getElementById('table-body');
const footerInfo = document.getElementById('footer-info');

function renderTable(data) {
    tableBody.innerHTML = '';
    if (!data || data.length === 0) { footerInfo.innerText = "Tidak ada data."; return; }
    data.forEach(item => {
        try {
            const row = document.createElement('tr');
            row.className = 'clickable-row'; 
            row.id = `row-${item.kode_saham}`; 
            const fmt = (n) => new Intl.NumberFormat('id-ID').format(Number(n) || 0);
            const fmtDec = (n) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(Number(n) || 0);
            const fmtShort = (n) => {
                if(Math.abs(n) >= 1000000000000) return (n/1000000000000).toFixed(1) + ' T';
                if(Math.abs(n) >= 1000000000) return (n/1000000000).toFixed(1) + ' M';
                return fmt(n);
            };
            const isWatchlist = item.isWatchlist || false;
            const starClass = isWatchlist ? 'text-warning' : 'text-secondary';
            const starIcon = isWatchlist ? '★' : '☆';
            const namaPendek = (item.nama_perusahaan || '').substring(0, 15);
            const kodeHtml = `
                <div class="d-flex align-items-center">
                    <span class="${starClass} star-btn me-2" onclick="toggleWatchlist('${item.kode_saham}')">${starIcon}</span>
                    <div>
                        <span class="fw-bold kode-saham-btn" onclick="openPortfolioModal('${item.kode_saham}')">${item.kode_saham}</span>
                        <br><small class="text-muted" style="font-size:9px;">${namaPendek}</small>
                    </div>
                </div>`;
            let asingColor = item.netForeign > 0 ? 'text-success' : (item.netForeign < 0 ? 'text-danger' : 'text-muted');
            const mcapForeignHtml = `
                <div><span class="badge bg-light text-dark border" style="font-size:9px;">${item.mcapLabel}</span></div>
                <small class="${asingColor}" style="font-size:10px;">${item.netForeign !== 0 ? fmtShort(item.netForeign) : '-'}</small>
            `;
            let metricHtml = '', badgeHtml = '';
            if (currentFilter === 'OWNED' && item.isOwned && item.portfolio) {
                const pl = Number(item.portfolio.plPercent) || 0;
                metricHtml = `<div class="${pl >= 0 ? 'text-success' : 'text-danger'} fw-bold">${pl >= 0 ? '+' : ''}${fmtDec(pl)}%</div>`;
                badgeHtml = `<span class="badge bg-secondary">${item.portfolio.status}</span>`;
                if (item.signal === 'ADD-ON 🔥') badgeHtml += `<br><span class="badge bg-primary mt-1" style="font-size:9px">ADD-ON 🔥</span>`;
            } else {
                metricHtml = `<div class="${item.change >= 0 ? 'text-success' : 'text-danger'} fw-bold">${item.change > 0 ? '+' : ''}${fmtDec(item.chgPercent)}%</div>`;
                const signal = item.signal || 'WAIT';
                if(signal === 'BUY') badgeHtml = `<span class="badge bg-success">BUY</span>`;
                else if(signal === 'SELL') badgeHtml = `<span class="badge bg-danger">SELL</span>`;
                else badgeHtml = `<span class="badge bg-light text-secondary border">WAIT</span>`;
            }
            row.innerHTML = `<td>${kodeHtml}</td><td>${fmt(item.penutupan)}</td><td class="text-end">${mcapForeignHtml}</td><td class="text-end">${metricHtml}</td><td class="text-center">${badgeHtml}</td>`;
            tableBody.appendChild(row);
        } catch (err) {}
    });
    footerInfo.innerText = `Menampilkan ${data.length} saham.`;
}

// ==========================================
// 7. WIDGET DASHBOARD (ALL 6 BOXES + VIEW MORE)
// ==========================================
window.toggleExpand = (id, btn) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.classList.contains('d-none')) {
        el.classList.remove('d-none');
        btn.innerHTML = 'Tutup ⌃';
    } else {
        el.classList.add('d-none');
        btn.innerHTML = 'Lihat Lainnya ⌄';
    }
};

function renderMarketOverview(data) {
    const widgetArea = document.getElementById('market-overview-area');
    const insightArea = document.getElementById('tech-recommendation-area');

    if (!data || data.length === 0) {
        if(widgetArea) widgetArea.style.display = 'none';
        if(insightArea) insightArea.style.display = 'none';
        return;
    }
    if(widgetArea) widgetArea.style.display = 'flex';
    if(insightArea) insightArea.style.display = 'flex';

    const fmt = (n) => new Intl.NumberFormat('id-ID').format(n);
    const fmtDec = (n) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(n);
    const fmtShort = (n) => {
        if(Math.abs(n) >= 1000000000000) return (n/1000000000000).toFixed(1) + ' T';
        if(Math.abs(n) >= 1000000000) return (n/1000000000).toFixed(1) + ' M';
        return fmt(n);
    };

    const createItem = (s, v, c) => `<li class="list-group-item d-flex justify-content-between align-items-center py-1"><span class="fw-bold cursor-pointer text-primary" onclick="openPortfolioModal('${s.kode_saham}')">${s.kode_saham}</span><span class="${c} fw-bold" style="font-size:0.85em">${v}</span></li>`;
    
    // Fungsi Generik
    const renderBox = (sortedData, listId, valFunc, colorFunc) => {
        const top5 = sortedData.slice(0, 5);
        const next15 = sortedData.slice(5, 20);
        let html = top5.map(s => createItem(s, valFunc(s), colorFunc(s))).join('');
        if (next15.length > 0) {
            html += `<div id="${listId}-hidden" class="d-none border-top mt-1 pt-1">`;
            html += next15.map(s => createItem(s, valFunc(s), colorFunc(s))).join('');
            html += `</div>`;
        }
        document.getElementById(listId).innerHTML = html;
    };

    renderBox([...data].sort((a,b)=>b.chgPercent-a.chgPercent), 'list-gainers', s=>`+${fmtDec(s.chgPercent)}%`, ()=>'text-success');
    renderBox([...data].sort((a,b)=>a.chgPercent-b.chgPercent), 'list-losers', s=>`${fmtDec(s.chgPercent)}%`, ()=>'text-danger');
    renderBox([...data].sort((a,b)=>b.volume-a.volume), 'list-volume', s=>fmt(s.volume), ()=>'text-dark');
    renderBox([...data].sort((a,b)=>b.mcapVal-a.mcapVal), 'list-mcap', s=>fmtShort(s.mcapVal), ()=>'text-primary');
    const foreignData = data.filter(s => s.netForeign > 0).sort((a,b)=>b.netForeign-a.netForeign);
    renderBox(foreignData, 'list-foreign', s=>'+'+fmtShort(s.netForeign), ()=>'text-info');
    renderBox([...data].sort((a,b)=>(b.frekuensi||0)-(a.frekuensi||0)), 'list-freq', s=>fmt(s.frekuensi)+'x', ()=>'text-warning text-dark');
}

// ==========================================
// 8. CHART & TECH ENGINE
// ==========================================
function calculateSMA(data, period) {
    if (data.length < period) return null;
    const slice = data.slice(data.length - period);
    return slice.reduce((a, b) => a + b, 0) / period;
}
function calculateRSI(prices, period = 14) {
    if (prices.length < period + 1) return null;
    let gains = 0, losses = 0;
    for (let i = 1; i <= period; i++) {
        const diff = prices[i] - prices[i - 1];
        if (diff >= 0) gains += diff; else losses += Math.abs(diff);
    }
    let avgGain = gains / period, avgLoss = losses / period;
    for (let i = period + 1; i < prices.length; i++) {
        const diff = prices[i] - prices[i - 1];
        avgGain = (avgGain * (period - 1) + (diff >= 0 ? diff : 0)) / period;
        avgLoss = (avgLoss * (period - 1) + (diff < 0 ? Math.abs(diff) : 0)) / period;
    }
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
}

async function loadAndRenderChart(kode) {
    const chartContainer = document.getElementById('price-chart');
    chartContainer.innerHTML = '<div class="spinner-border text-primary" role="status"></div>'; 
    const currentPreset = localStorage.getItem('def_preset') || 'moderate';
    const strategy = STRATEGIES[currentPreset] || STRATEGIES['moderate'];
    const maPeriod = strategy.ma || 20; 

    const { data: history, error } = await db
        .from('history_saham').select('*').eq('kode_saham', kode)
        .order('tanggal_perdagangan_terakhir', { ascending: true }).limit(100); 

    if (error || !history || history.length < maPeriod) {
        chartContainer.innerHTML = `<small class="text-muted">Butuh min ${maPeriod} data untuk MA${maPeriod}.</small>`;
        return;
    }

    const prices = history.map(h => Number(h.penutupan));
    const dates = history.map(h => new Date(h.tanggal_perdagangan_terakhir).getTime());
    const currentPrice = prices[prices.length - 1];
    const maVal = calculateSMA(prices, maPeriod);
    const trendStatus = maVal ? (currentPrice > maVal ? `UP (MA${maPeriod}) 🟢` : `DOWN (MA${maPeriod}) 🔴`) : '-';
    const rsiVal = calculateRSI(prices, 14);
    let rsiStatus = rsiVal ? (rsiVal > 70 ? `${rsiVal.toFixed(0)} (HOT) 🔴` : (rsiVal < 30 ? `${rsiVal.toFixed(0)} (LOW) 🟢` : `${rsiVal.toFixed(0)}`)) : '-';

    document.getElementById('tech-trend').innerText = trendStatus;
    document.getElementById('tech-rsi').innerText = rsiStatus;
    document.getElementById('tech-sr').innerText = `${Math.min(...prices.slice(-20))} / ${Math.max(...prices.slice(-20))}`;
    
    const candleSeries = history.map(item => ({ x: new Date(item.tanggal_perdagangan_terakhir).getTime(), y: [item.open_price, item.tertinggi, item.terendah, item.penutupan] }));
    let maSeries = [];
    for(let i = maPeriod; i < history.length; i++) {
        const slice = prices.slice(i-maPeriod, i);
        const avg = slice.reduce((a,b)=>a+b,0)/maPeriod;
        maSeries.push({ x: dates[i], y: avg });
    }

    const options = {
        series: [{ name: 'Harga', type: 'candlestick', data: candleSeries }, { name: `MA ${maPeriod}`, type: 'line', data: maSeries }],
        chart: { type: 'line', height: 280, toolbar: { show: false } },
        stroke: { width: [1, 2], curve: 'smooth' }, 
        colors: ['#00E396', '#546E7A'], 
        xaxis: { type: 'datetime' },
        yaxis: { labels: { formatter: (val) => new Intl.NumberFormat('id-ID').format(val) } },
        plotOptions: { candlestick: { colors: { upward: '#198754', downward: '#dc3545' } } },
        grid: { borderColor: '#f1f1f1' }
    };
    if (priceChart) priceChart.destroy();
    chartContainer.innerHTML = ''; 
    priceChart = new ApexCharts(chartContainer, options);
    priceChart.render();
}

// ==========================================
// 9. MODAL & UPLOAD
// ==========================================
let sortDir = 'asc';
window.sortTable = (n) => {
    sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    const rows = Array.from(tableBody.querySelectorAll('tr'));
    rows.sort((rowA, rowB) => {
        let valA = rowA.children[n].innerText.trim();
        let valB = rowB.children[n].innerText.trim();
        const parseNum = (str) => {
            const match = str.match(/[-+]?[0-9]*\.?[0-9]+/); 
            if(!match) return str; 
            let clean = match[0].replace(/\./g, '').replace(',', '.');
            const num = parseFloat(clean);
            return isNaN(num) ? str : num;
        };
        if (n === 0) { valA = valA.split('\n')[0].trim(); valB = valB.split('\n')[0].trim(); }
        const a = parseNum(valA); const b = parseNum(valB);
        if (a < b) return sortDir === 'asc' ? -1 : 1;
        if (a > b) return sortDir === 'asc' ? 1 : -1;
        return 0;
    });
    rows.forEach(row => tableBody.appendChild(row));
};

// STRATEGY LOGIC (LOCK/UNLOCK)
window.applyStrategyPreset = () => {
    const elPreset = document.getElementById('strategy-preset');
    const elTp = document.getElementById('default-tp');
    const elCl = document.getElementById('default-cl');
    const elMa = document.getElementById('default-ma');
    const elRsi = document.getElementById('default-rsi');
    const elDesc = document.getElementById('strategy-desc');

    if (!elPreset) return;
    const val = elPreset.value;

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

window.openStrategyModal = () => {
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
    if (!strategyModal) strategyModal = new bootstrap.Modal(document.getElementById('strategyModal'));
    strategyModal.show();
};

document.getElementById('strategy-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    localStorage.setItem('def_tp', document.getElementById('default-tp').value);
    localStorage.setItem('def_cl', document.getElementById('default-cl').value);
    localStorage.setItem('def_ma', document.getElementById('default-ma').value);
    localStorage.setItem('def_rsi', document.getElementById('default-rsi').value);
    localStorage.setItem('def_preset', document.getElementById('strategy-preset').value);
    strategyModal.hide();
    showAlert('success', 'Konfigurasi Strategi Tersimpan.');
});

// Portofolio logic
const formKode = document.getElementById('input-kode');
const formAvg = document.getElementById('input-avg');
const formLots = document.getElementById('input-lots');
const formTpPct = document.getElementById('input-tp-pct');
const formClPct = document.getElementById('input-cl-pct');
const formNotes = document.getElementById('input-notes');
const checkWatchlist = document.getElementById('input-watchlist');
const labelModalKode = document.getElementById('modal-kode-saham');
const labelModalNama = document.getElementById('modal-nama-perusahaan');
const btnDelete = document.getElementById('btn-delete-portfolio');
const txtCalcTp = document.getElementById('calc-tp');
const txtCalcCl = document.getElementById('calc-cl');

function updateCalc() {
    const avg = parseFloat(formAvg.value) || 0;
    const tpPct = parseFloat(formTpPct.value) || 0;
    const clPct = parseFloat(formClPct.value) || 0;
    const tpPrice = Math.round(avg * (1 + tpPct/100));
    const clPrice = Math.round(avg * (1 - clPct/100));
    txtCalcTp.innerText = tpPct > 0 ? `Target: Rp ${new Intl.NumberFormat('id-ID').format(tpPrice)}` : 'Target: -';
    txtCalcCl.innerText = clPct > 0 ? `Stop: Rp ${new Intl.NumberFormat('id-ID').format(clPrice)}` : 'Stop: -';
}
formAvg.addEventListener('input', updateCalc);
formTpPct.addEventListener('input', updateCalc);
formClPct.addEventListener('input', updateCalc);

window.openPortfolioModal = (kode) => {
    const stock = allStocks.find(s => s.kode_saham === kode);
    const owned = myPortfolio.find(p => p.kode_saham === kode);
    labelModalKode.innerText = kode;
    if(labelModalNama) labelModalNama.innerText = stock ? stock.nama_perusahaan : '';
    formKode.value = kode;
    
    if (owned) {
        formAvg.value = owned.avg_price; formLots.value = owned.lots;
        formTpPct.value = owned.tp_pct || ''; formClPct.value = owned.cl_pct || ''; 
        formNotes.value = owned.notes || ''; checkWatchlist.checked = owned.is_watchlist; 
        if(btnDelete) btnDelete.style.display = 'block';
    } else {
        formAvg.value = stock ? stock.penutupan : 0; formLots.value = 1;
        formTpPct.value = localStorage.getItem('def_tp') || '';
        formClPct.value = localStorage.getItem('def_cl') || '';
        formNotes.value = ''; checkWatchlist.checked = false;
        if(btnDelete) btnDelete.style.display = 'none';
    }
    updateCalc();
    loadAndRenderChart(kode);
    if(!portfolioModal) portfolioModal = new bootstrap.Modal(document.getElementById('portfolioModal'));
    portfolioModal.show();
};

window.toggleWatchlist = async (kode) => {
    const owned = myPortfolio.find(p => p.kode_saham === kode);
    const newStatus = owned ? !owned.is_watchlist : true;
    const payload = { user_id: currentUser.id, kode_saham: kode, is_watchlist: newStatus };
    if (!owned) { payload.avg_price = 0; payload.lots = 0; }
    const { error } = await db.from('portfolio').upsert(payload, { onConflict: 'user_id, kode_saham' });
    if(!error) await loadData(); 
    else showAlert('danger', 'Gagal update watchlist');
};

document.getElementById('portfolio-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    showAlert('info', 'Menyimpan...');
    portfolioModal.hide();
    const payload = {
        user_id: currentUser.id,
        kode_saham: formKode.value,
        avg_price: formAvg.value,
        lots: formLots.value,
        tp_pct: formTpPct.value || 0,
        cl_pct: formClPct.value || 0,
        notes: formNotes.value,
        is_watchlist: checkWatchlist.checked
    };
    const { error } = await db.from('portfolio').upsert(payload, { onConflict: 'user_id, kode_saham' });
    if (error) showAlert('danger', error.message);
    else { await loadData(); showAlert('success', 'Tersimpan!'); }
});

btnDelete?.addEventListener('click', async () => {
    if(!confirm("Hapus?")) return;
    portfolioModal.hide();
    const { error } = await db.from('portfolio').delete().match({ user_id: currentUser.id, kode_saham: formKode.value });
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
                        bid: clean(getVal(['Bid'])),
                        bid_volume: clean(getVal(['Bid Volume'])),
                        offer: clean(getVal(['Offer'])),
                        offer_volume: clean(getVal(['Offer Volume'])),
                        foreign_sell: clean(getVal(['Foreign Sell'])),
                        foreign_buy: clean(getVal(['Foreign Buy'])),
                        index_individual: clean(getVal(['Index Individual'])),
                        weight_for_index: clean(getVal(['Weight For Index'])),
                        listed_shares: clean(getVal(['Listed Shares'])),
                        tradeable_shares: clean(getVal(['Tradeble Shares', 'Tradeable Shares'])), 
                        non_regular_volume: clean(getVal(['Non Regular Volume'])),
                        non_regular_value: clean(getVal(['Non Regular Value'])),
                        non_regular_frequency: clean(getVal(['Non Regular Frequency'])),
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
    showAlert('warning', `Memeriksa tanggal data...`);
    let shouldUpdateSnapshot = true; 
    
    if (dataSaham.length > 0) {
        const csvDateStr = dataSaham[0].tanggal_perdagangan_terakhir; 
        const csvDate = new Date(csvDateStr).getTime();
        const { data: dbData, error } = await db.from('data_saham').select('tanggal_perdagangan_terakhir').order('tanggal_perdagangan_terakhir', { ascending: false }).limit(1);
        if (!error && dbData && dbData.length > 0) {
            const dbDateStr = dbData[0].tanggal_perdagangan_terakhir;
            const dbDate = new Date(dbDateStr).getTime();
            if (csvDate < dbDate) {
                shouldUpdateSnapshot = false;
                showAlert('info', `⚠️ Mode Arsip: Data CSV (${csvDateStr}) lebih tua dari DB (${dbDateStr}). Snapshot tidak diupdate.`);
                await new Promise(r => setTimeout(r, 2000));
            }
        }
    }

    const batchSize = 50; 
    let errorCount = 0; 
    if (shouldUpdateSnapshot) {
        for (let i = 0; i < dataSaham.length; i += batchSize) {
            const batch = dataSaham.slice(i, i + batchSize);
            const percent = Math.round((i / dataSaham.length) * 50);
            showAlert('warning', `Update Pasar: ${percent}% ...`);
            const { error } = await db.from('data_saham').upsert(batch, { onConflict: 'kode_saham' });
            if (error) errorCount++;
        }
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
    for (let i = 0; i < historyData.length; i += batchSize) {
        const batch = historyData.slice(i, i + batchSize);
        const startPct = shouldUpdateSnapshot ? 50 : 0;
        const divider = shouldUpdateSnapshot ? 50 : 100;
        const percent = startPct + Math.round((i / historyData.length) * divider);
        showAlert('warning', `Arsip History: ${percent}% ...`);
        const { error } = await db.from('history_saham').upsert(batch, { onConflict: 'kode_saham, tanggal_perdagangan_terakhir' });
        if (error) errorCount++;
    }

    if (errorCount === 0) {
        showAlert('success', 'SUKSES! Data diproses.');
        const csvInput = document.getElementById('csv-file-input');
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
