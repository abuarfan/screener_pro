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

// Inisialisasi Modal dengan aman
let portfolioModal; 
let strategyModal;

document.addEventListener('DOMContentLoaded', () => {
    try { 
        portfolioModal = new bootstrap.Modal(document.getElementById('portfolioModal')); 
        strategyModal = new bootstrap.Modal(document.getElementById('strategyModal'));
    } catch(e) { console.log("Modal init waiting..."); }
});

async function checkSession() {
    const { data: { session } } = await db.auth.getSession();
    if (!session) {
        window.location.href = 'login.html';
    } else {
        currentUser = session.user;
        loadData(); 
    }
}
checkSession();

document.getElementById('btn-logout')?.addEventListener('click', async () => {
    if(confirm("Logout?")) {
        await db.auth.signOut();
        window.location.href = 'login.html';
    }
});

// ==========================================
// 3. LOAD DATA
// ==========================================
async function loadData() {
    showAlert('primary', 'Sinkronisasi data...');
    
    // Request data
    const marketReq = db.from('data_saham').select('*').order('kode_saham', { ascending: true }).limit(2000);
    const portfolioReq = db.from('portfolio').select('*');

    const [marketRes, portfolioRes] = await Promise.all([marketReq, portfolioReq]);

    if (marketRes.error) {
        showAlert('danger', 'Gagal load: ' + marketRes.error.message);
        return;
    }

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
        } else {
            searchResults.classList.add('d-none');
        }
    });

    document.addEventListener('click', (e) => {
        if (!searchInput.contains(e.target) && !searchResults.contains(e.target)) {
            searchResults.classList.add('d-none');
        }
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
        } else {
            alert("Saham tidak ditemukan di tampilan saat ini.");
        }
    }, 500); 
};

// ==========================================
// 5. ANALISA & FILTER (MARKET CAP & FOREIGN)
// ==========================================
function setFilter(type) {
    currentFilter = type;
    applyFilterAndRender();
}

function applyFilterAndRender() {
    const processedData = allStocks.map(stock => {
        const owned = myPortfolio.find(p => p.kode_saham === stock.kode_saham);
        return analyzeStock(stock, owned);
    });

    // Update Widget Dashboard
    if(typeof renderMarketOverview === 'function') {
        renderMarketOverview(processedData);
    }

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

    // --- FITUR BARU 1: MARKET CAP ---
    const shares = Number(stock.listed_shares) || 0;
    const mcapVal = close * shares; 
    let mcapLabel = '';
    if (mcapVal >= 10000000000000) mcapLabel = '🟦 BIG'; // >10T
    else if (mcapVal >= 1000000000000) mcapLabel = '🟨 MID'; // 1T - 10T
    else mcapLabel = '⬜ SML'; // <1T

    // --- FITUR BARU 2: FOREIGN FLOW ---
    const fBuy = Number(stock.foreign_buy) || 0;
    const fSell = Number(stock.foreign_sell) || 0;
    const netForeign = fBuy - fSell;
    let foreignStatus = '-';
    if (netForeign > 1000000000) foreignStatus = 'Asing AKUM 🟢'; 
    else if (netForeign < -1000000000) foreignStatus = 'Asing DIST 🔴'; 

    // --- ANALISA SIGNAL ---
    let signal = 'WAIT';
    if (chgPercent >= 1) signal = 'BUY';
    else if (chgPercent <= -1) signal = 'SELL';
    
    // Portfolio Logic
    let portfolioInfo = null;
    let isOwned = false;
    let isWatchlist = false;

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

    return { 
        ...stock, change, chgPercent, signal, isOwned, isWatchlist, portfolio: portfolioInfo,
        mcapVal, mcapLabel, netForeign, foreignStatus 
    };
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

            // A. KOLOM KODE
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

            // B. KOLOM MCAP & ASING
            let asingColor = item.netForeign > 0 ? 'text-success' : (item.netForeign < 0 ? 'text-danger' : 'text-muted');
            const mcapForeignHtml = `
                <div><span class="badge bg-light text-dark border" style="font-size:9px;">${item.mcapLabel}</span></div>
                <small class="${asingColor}" style="font-size:10px;">${item.netForeign !== 0 ? fmtShort(item.netForeign) : '-'}</small>
            `;

            // C. METRIK
            let metricHtml = '', badgeHtml = '';
            const color = item.change >= 0 ? 'text-success' : 'text-danger';
            
            if (currentFilter === 'OWNED' && item.isOwned && item.portfolio) {
                const pl = Number(item.portfolio.plPercent) || 0;
                metricHtml = `<div class="${pl >= 0 ? 'text-success' : 'text-danger'} fw-bold">${pl >= 0 ? '+' : ''}${fmtDec(pl)}%</div>`;
                badgeHtml = `<span class="badge bg-secondary">${item.portfolio.status}</span>`;
                if (item.signal === 'ADD-ON 🔥') badgeHtml += `<br><span class="badge bg-primary mt-1" style="font-size:9px">ADD-ON 🔥</span>`;
            } else {
                metricHtml = `<div class="${color} fw-bold">${item.change > 0 ? '+' : ''}${fmtDec(item.chgPercent)}%</div>`;
                const signal = item.signal || 'WAIT';
                if(signal === 'BUY') badgeHtml = `<span class="badge bg-success">BUY</span>`;
                else if(signal === 'SELL') badgeHtml = `<span class="badge bg-danger">SELL</span>`;
                else badgeHtml = `<span class="badge bg-light text-secondary border">WAIT</span>`;
            }

            row.innerHTML = `
                <td>${kodeHtml}</td>
                <td>${fmt(item.penutupan)}</td>
                <td class="text-end">${mcapForeignHtml}</td>
                <td class="text-end">${metricHtml}</td>
                <td class="text-center">${badgeHtml}</td>
            `;
            tableBody.appendChild(row);

        } catch (err) {}
    });
    footerInfo.innerText = `Menampilkan ${data.length} saham.`;
}

// ==========================================
// 7. WIDGET DASHBOARD (UPDATED)
// ==========================================
function renderMarketOverview(data) {
    // Area Widget Utama
    const widgetArea = document.getElementById('market-overview-area');
    const listGainers = document.getElementById('list-gainers');
    const listLosers = document.getElementById('list-losers');
    const listVolume = document.getElementById('list-volume');
    
    // Area Widget Insight (Baru)
    const insightArea = document.getElementById('tech-recommendation-area');
    const listMcap = document.getElementById('list-mcap');
    const listForeign = document.getElementById('list-foreign');
    const listFreq = document.getElementById('list-freq');

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

    // Helper Template List Item
    const createItem = (stock, valueLabel, colorClass) => `
        <li class="list-group-item d-flex justify-content-between align-items-center py-1">
            <span class="fw-bold cursor-pointer text-primary" onclick="openPortfolioModal('${stock.kode_saham}')">${stock.kode_saham}</span>
            <span class="${colorClass} fw-bold" style="font-size:0.85em">${valueLabel}</span>
        </li>`;

    // --- ROW 1: HARGA ---
    // Top Gainers
    const topGainers = [...data].sort((a, b) => b.chgPercent - a.chgPercent).slice(0, 5);
    listGainers.innerHTML = topGainers.map(s => createItem(s, `+${fmtDec(s.chgPercent)}%`, 'text-success')).join('');

    // Top Losers
    const topLosers = [...data].sort((a, b) => a.chgPercent - b.chgPercent).slice(0, 5);
    listLosers.innerHTML = topLosers.map(s => createItem(s, `${fmtDec(s.chgPercent)}%`, 'text-danger')).join('');

    // Top Volume
    const topVolume = [...data].sort((a, b) => b.volume - a.volume).slice(0, 5);
    listVolume.innerHTML = topVolume.map(s => createItem(s, fmt(s.volume), 'text-dark')).join('');

    // --- ROW 2: INSIGHT ---
    // Big Market Cap
    const topMcap = [...data].sort((a, b) => b.mcapVal - a.mcapVal).slice(0, 5);
    listMcap.innerHTML = topMcap.map(s => createItem(s, fmtShort(s.mcapVal), 'text-primary')).join('');

    // Foreign Accumulation (Net Buy)
    const topForeign = [...data].sort((a, b) => b.netForeign - a.netForeign).slice(0, 5);
    listForeign.innerHTML = topForeign.map(s => {
        // Hanya tampilkan jika Net Buy positif
        if(s.netForeign <= 0) return '';
        return createItem(s, '+' + fmtShort(s.netForeign), 'text-info');
    }).join('');

    // Top Frequency (Saham Paling Ramai Ditransaksikan)
    const topFreq = [...data].sort((a, b) => (b.frekuensi || 0) - (a.frekuensi || 0)).slice(0, 5);
    listFreq.innerHTML = topFreq.map(s => createItem(s, fmt(s.frekuensi) + 'x', 'text-warning text-dark')).join('');
}

// ==========================================
// 8. CHART & TECHNICAL ANALYSIS ENGINE
// ==========================================
function calculateSMA(data, period) {
    if (data.length < period) return null;
    const slice = data.slice(data.length - period);
    const sum = slice.reduce((a, b) => a + b, 0);
    return sum / period;
}

function calculateRSI(prices, period = 14) {
    if (prices.length < period + 1) return null;
    let gains = 0, losses = 0;
    for (let i = 1; i <= period; i++) {
        const diff = prices[i] - prices[i - 1];
        if (diff >= 0) gains += diff; else losses += Math.abs(diff);
    }
    let avgGain = gains / period;
    let avgLoss = losses / period;
    
    for (let i = period + 1; i < prices.length; i++) {
        const diff = prices[i] - prices[i - 1];
        const gain = diff >= 0 ? diff : 0;
        const loss = diff < 0 ? Math.abs(diff) : 0;
        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;
    }
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
}

async function loadAndRenderChart(kode) {
    const chartContainer = document.getElementById('price-chart');
    chartContainer.innerHTML = '<div class="spinner-border text-primary" role="status"></div>'; 

    const { data: history, error } = await db
        .from('history_saham')
        .select('tanggal_perdagangan_terakhir, penutupan, open_price, tertinggi, terendah')
        .eq('kode_saham', kode)
        .order('tanggal_perdagangan_terakhir', { ascending: true })
        .limit(100); 

    if (error || !history || history.length < 2) {
        chartContainer.innerHTML = '<small class="text-muted">Data history kurang dari 2 hari.</small>';
        resetTechLabels();
        return;
    }

    const prices = history.map(h => Number(h.penutupan));
    const dates = history.map(h => new Date(h.tanggal_perdagangan_terakhir).getTime());
    const currentPrice = prices[prices.length - 1];

    // INDIKATOR
    const ma20 = calculateSMA(prices, 20);
    const trendStatus = ma20 ? (currentPrice > ma20 ? 'UPTREND 🟢' : 'DOWNTREND 🔴') : 'Need Data';

    const rsiVal = calculateRSI(prices, 14);
    let rsiStatus = '-';
    if(rsiVal) {
        if(rsiVal > 70) rsiStatus = `${rsiVal.toFixed(0)} (MAHAL) 🔴`;
        else if(rsiVal < 30) rsiStatus = `${rsiVal.toFixed(0)} (MURAH) 🟢`;
        else rsiStatus = `${rsiVal.toFixed(0)} (Netral)`;
    }

    const low20 = Math.min(...prices.slice(-20));
    const high20 = Math.max(...prices.slice(-20));
    const ma5 = calculateSMA(prices, 5);
    const macdStatus = (ma5 && ma20) ? (ma5 > ma20 ? 'Golden Cross ↗️' : 'Dead Cross ↘️') : '-';

    document.getElementById('tech-trend').innerText = trendStatus;
    document.getElementById('tech-rsi').innerText = rsiStatus;
    document.getElementById('tech-sr').innerText = `${low20} / ${high20}`;
    document.getElementById('tech-macd').innerText = macdStatus;

    // Chart Data
    const candleSeries = history.map(item => ({
        x: new Date(item.tanggal_perdagangan_terakhir).getTime(),
        y: [item.open_price, item.tertinggi, item.terendah, item.penutupan]
    }));

    let maSeries = [];
    for(let i = 20; i < history.length; i++) {
        const slice = prices.slice(i-20, i);
        const avg = slice.reduce((a,b)=>a+b,0)/20;
        maSeries.push({ x: dates[i], y: avg });
    }

    const options = {
        series: [
            { name: 'Harga', type: 'candlestick', data: candleSeries },
            { name: 'MA 20', type: 'line', data: maSeries }
        ],
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

function resetTechLabels() {
    document.getElementById('tech-trend').innerText = '-';
    document.getElementById('tech-rsi').innerText = '-';
    document.getElementById('tech-sr').innerText = '-';
    document.getElementById('tech-macd').innerText = '-';
}

// ==========================================
// 9. MODAL LOGIC & UPLOAD (DIPULIHKAN)
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

// STRATEGY LOGIC
const STRATEGIES = {
    'conservative': { tp: 15, cl: 7, desc: "Swing Trade (Santai)" },
    'moderate':     { tp: 8,  cl: 4, desc: "Day Trade (Seimbang)" },
    'aggressive':   { tp: 3,  cl: 2, desc: "Scalping (Cepat)" }
};

window.applyStrategyPreset = () => {
    const elPreset = document.getElementById('strategy-preset');
    const elTp = document.getElementById('default-tp');
    const elCl = document.getElementById('default-cl');
    const elDesc = document.getElementById('strategy-desc');
    if (!elPreset || !elTp) return;

    const val = elPreset.value;
    if (val === 'custom') {
        elDesc.innerText = "Manual custom.";
    } else {
        const strat = STRATEGIES[val];
        if (strat) {
            elTp.value = strat.tp;
            elCl.value = strat.cl;
            elDesc.innerText = strat.desc;
        }
    }
};

window.openStrategyModal = () => {
    const elTp = document.getElementById('default-tp');
    const elCl = document.getElementById('default-cl');
    const elPreset = document.getElementById('strategy-preset');
    
    if(elTp) elTp.value = localStorage.getItem('def_tp') || '';
    if(elCl) elCl.value = localStorage.getItem('def_cl') || '';
    if(elPreset) elPreset.value = localStorage.getItem('def_preset') || 'custom';
    
    if (!strategyModal) strategyModal = new bootstrap.Modal(document.getElementById('strategyModal'));
    strategyModal.show();
};

document.getElementById('strategy-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    localStorage.setItem('def_tp', document.getElementById('default-tp').value);
    localStorage.setItem('def_cl', document.getElementById('default-cl').value);
    localStorage.setItem('def_preset', document.getElementById('strategy-preset').value);
    strategyModal.hide();
    showAlert('success', 'Strategi tersimpan.');
});

// PORTOFOLIO LOGIC
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
        formAvg.value = owned.avg_price;
        formLots.value = owned.lots;
        formTpPct.value = owned.tp_pct || '';
        formClPct.value = owned.cl_pct || ''; 
        formNotes.value = owned.notes || '';
        checkWatchlist.checked = owned.is_watchlist; 
        if(btnDelete) btnDelete.style.display = 'block';
    } else {
        formAvg.value = stock ? stock.penutupan : 0;
        formLots.value = 1;
        formTpPct.value = localStorage.getItem('def_tp') || '';
        formClPct.value = localStorage.getItem('def_cl') || '';
        formNotes.value = '';
        checkWatchlist.checked = false;
        if(btnDelete) btnDelete.style.display = 'none';
    }
    updateCalc();
    
    // LOAD CHART & TEKNIKAL
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

// CSV UPLOAD LOGIC
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
