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
        }
    }, 300); 
};

// ==========================================
// 5. ANALISA & FILTER (MARKET CAP & FOREIGN ADDED)
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

    // --- FITUR BARU 1: MARKET CAP ---
    const shares = Number(stock.listed_shares) || 0;
    const mcapVal = close * shares; 
    let mcapLabel = '';
    // Klasifikasi Sederhana
    if (mcapVal >= 10000000000000) mcapLabel = '🟦 BIG'; // >10T (Bluechip/Big)
    else if (mcapVal >= 1000000000000) mcapLabel = '🟨 MID'; // 1T - 10T
    else mcapLabel = '⬜ SML'; // <1T (Small/Gorengan)

    // --- FITUR BARU 2: FOREIGN FLOW ---
    const fBuy = Number(stock.foreign_buy) || 0;
    const fSell = Number(stock.foreign_sell) || 0;
    const netForeign = fBuy - fSell;
    let foreignStatus = '';
    if (netForeign > 1000000000) foreignStatus = 'Asing AKUM 🟢'; // > 1 Milyar
    else if (netForeign < -1000000000) foreignStatus = 'Asing DIST 🔴'; // < -1 Milyar
    else foreignStatus = '-';

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
// 6. RENDER TABLE (WITH NEW COLUMNS)
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
            const fmtShort = (n) => { // Format Milyar/Triliun
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

            // B. KOLOM BARU: MCAP & ASING
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
// 7. CHART & TECHNICAL ANALYSIS ENGINE
// ==========================================
// --- RUMUS MATEMATIKA ---
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
    
    // RSI Akhir (Simplified for last data point)
    // Sebaiknya smoothing, tapi ini estimasi cukup
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

    // Ambil Data Lebih Banyak (60 hari) untuk perhitungan teknikal
    const { data: history, error } = await db
        .from('history_saham')
        .select('tanggal_perdagangan_terakhir, penutupan, open_price, tertinggi, terendah')
        .eq('kode_saham', kode)
        .order('tanggal_perdagangan_terakhir', { ascending: true })
        .limit(100); 

    if (error || !history || history.length < 2) {
        chartContainer.innerHTML = '<small class="text-muted">Data history tidak cukup untuk analisa.</small>';
        resetTechLabels();
        return;
    }

    // --- 1. DATA PROCESSING ---
    const prices = history.map(h => Number(h.penutupan));
    const dates = history.map(h => new Date(h.tanggal_perdagangan_terakhir).getTime());
    const currentPrice = prices[prices.length - 1];

    // --- 2. HITUNG INDIKATOR ---
    // A. MA20
    const ma20 = calculateSMA(prices, 20);
    const trendStatus = ma20 ? (currentPrice > ma20 ? 'UPTREND 🟢' : 'DOWNTREND 🔴') : 'Need Data';

    // B. RSI (14)
    const rsiVal = calculateRSI(prices, 14);
    let rsiStatus = '-';
    if(rsiVal) {
        if(rsiVal > 70) rsiStatus = `${rsiVal.toFixed(0)} (MAHAL) 🔴`;
        else if(rsiVal < 30) rsiStatus = `${rsiVal.toFixed(0)} (MURAH) 🟢`;
        else rsiStatus = `${rsiVal.toFixed(0)} (Netral)`;
    }

    // C. Support & Resistance (Simple: Lowest/Highest 20 days)
    const low20 = Math.min(...prices.slice(-20));
    const high20 = Math.max(...prices.slice(-20));

    // D. MACD (Simulasi Simple: Bullish/Bearish based on momentum)
    // Real MACD butuh EMA 12 & 26. Kita pakai simplified logic: 
    // Kalau MA5 > MA20 = Bullish
    const ma5 = calculateSMA(prices, 5);
    const macdStatus = (ma5 && ma20) ? (ma5 > ma20 ? 'Golden Cross ↗️' : 'Dead Cross ↘️') : '-';

    // --- 3. TAMPILKAN TEXT ---
    document.getElementById('tech-trend').innerText = trendStatus;
    document.getElementById('tech-rsi').innerText = rsiStatus;
    document.getElementById('tech-sr').innerText = `${low20} / ${high20}`;
    document.getElementById('tech-macd').innerText = macdStatus;

    // --- 4. RENDER CHART (DENGAN GARIS MA) ---
    // Series Candle
    const candleSeries = history.map(item => ({
        x: new Date(item.tanggal_perdagangan_terakhir).getTime(),
        y: [item.open_price, item.tertinggi, item.terendah, item.penutupan]
    }));

    // Series MA20 (Kita hitung mundur manual agar garisnya terbentuk)
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
        stroke: { width: [1, 2], curve: 'smooth' }, // Garis MA tebal 2
        colors: ['#00E396', '#546E7A'], // Warna Candle & Garis
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
// 8. LAIN-LAIN (Market Overview, Modal, dll)
// ==========================================
// (Bagian ini SAMA seperti kode sebelumnya, copy paste saja)
// ... Market Overview ...
// ... Sorting ...
// ... Modal & Strategy ...
// ... Upload CSV ...

// PASTIKAN ANDA MENYALIN KODE SISA (Market Overview, Modal, dll) DARI FILE SEBELUMNYA
// ATAU GABUNGKAN SENDIRI. KARENA KETERBATASAN PANJANG CHAT, SAYA POTONG DISINI.
// TAPI BAGIAN 1-7 DI ATAS ADALAH INTI PERUBAHANNYA.
