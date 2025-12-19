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
let priceChart = null; // Instance Chart

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
    else showAlert('warning', 'Data kosong. Silakan upload CSV.');
}

// ==========================================
// 4. SEARCH FUNCTIONALITY (BARU)
// ==========================================
const searchInput = document.getElementById('input-search');
const searchResults = document.getElementById('search-results');

if(searchInput) {
    searchInput.addEventListener('input', (e) => {
        const val = e.target.value.toLowerCase().trim();
        if(val.length < 2) {
            searchResults.classList.add('d-none');
            return;
        }

        // Filter Saham (Limit 10 result biar gak lemot)
        const matches = allStocks.filter(s => 
            s.kode_saham.toLowerCase().includes(val) || 
            (s.nama_perusahaan && s.nama_perusahaan.toLowerCase().includes(val))
        ).slice(0, 10);

        if(matches.length > 0) {
            searchResults.innerHTML = matches.map(s => `
                <a href="#" class="list-group-item list-group-item-action" onclick="jumpToStock('${s.kode_saham}')">
                    <strong>${s.kode_saham}</strong> - <small>${s.nama_perusahaan}</small>
                </a>
            `).join('');
            searchResults.classList.remove('d-none');
        } else {
            searchResults.classList.add('d-none');
        }
    });

    // Sembunyikan search result kalau klik di luar
    document.addEventListener('click', (e) => {
        if (!searchInput.contains(e.target) && !searchResults.contains(e.target)) {
            searchResults.classList.add('d-none');
        }
    });
}

window.jumpToStock = (kode) => {
    // 1. Reset filter ke ALL agar saham terlihat
    document.getElementById('filter-all').click(); 
    
    // 2. Hide search result & clear input
    searchResults.classList.add('d-none');
    searchInput.value = '';

    // 3. Cari baris di tabel (gunakan DOM, cari tr yang punya ID atau data attribute)
    // Karena kita render ulang saat filter change, kita perlu delay sedikit
    setTimeout(() => {
        const targetRow = document.getElementById(`row-${kode}`);
        if(targetRow) {
            targetRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
            targetRow.classList.add('highlight-search'); // Efek kedip
            setTimeout(() => targetRow.classList.remove('highlight-search'), 2000);
        } else {
            alert(`Saham ${kode} tidak ditemukan di tabel.`);
        }
    }, 300); // Delay agar render selesai dulu
};

// ==========================================
// 5. ANALISA & FILTER LOGIC
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
    renderMarketOverview(processedData);

    let filteredData = [];
    if (currentFilter === 'ALL') {
        filteredData = processedData;
    } else if (currentFilter === 'WATCHLIST') {
        filteredData = processedData.filter(s => s.isWatchlist || s.isOwned);
    } else if (currentFilter === 'OWNED') {
        filteredData = processedData.filter(s => s.isOwned);
    }

    renderTable(filteredData);
}

function analyzeStock(stock, ownedData) {
    const close = Number(stock.penutupan) || 0;
    const prev = Number(stock.sebelumnya) || close;
    
    const change = close - prev;
    const chgPercent = prev === 0 ? 0 : (change / prev) * 100;

    // --- SETUP ---
    let signal = 'WAIT';
    let portfolioInfo = null;
    let isOwned = false;
    let isWatchlist = false;

    // --- ANALISA MARKET ---
    if (chgPercent >= 1) signal = 'BUY';
    else if (chgPercent <= -1) signal = 'SELL';
    else if (chgPercent < 0 && chgPercent > -1) signal = 'RE-ENTRY?';
    
    // --- ANALISA PORTOFOLIO ---
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

            if (plPercent > 2 && chgPercent > 0.5) {
                signal = 'ADD-ON 🔥'; 
            }

            portfolioInfo = { 
                avg: avgPrice, lots, tpPct, clPct, tpPrice, clPrice,
                notes: ownedData.notes, plPercent, status: actionStatus
            };
        }
    }

    return { ...stock, change, chgPercent, signal, isOwned, isWatchlist, portfolio: portfolioInfo };
}

// ==========================================
// 6. RENDER TABLE (UPDATED COLUMN ORDER)
// ==========================================
const tableBody = document.getElementById('table-body');
const footerInfo = document.getElementById('footer-info');

function renderTable(data) {
    tableBody.innerHTML = '';
    
    if (!data || data.length === 0) {
        footerInfo.innerText = "Tidak ada data.";
        return;
    }

    data.forEach(item => {
        try {
            const row = document.createElement('tr');
            row.className = 'clickable-row'; 
            row.id = `row-${item.kode_saham}`; // ID untuk fitur Search Scroll
            
            const fmt = (n) => new Intl.NumberFormat('id-ID').format(Number(n) || 0);
            const fmtDec = (n) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(Number(n) || 0);

            let metricHtml = '';
            let badgeHtml = '';

            // --- A. KODE ---
            const isWatchlist = item.isWatchlist || false;
            const starClass = isWatchlist ? 'text-warning' : 'text-secondary';
            const starIcon = isWatchlist ? '★' : '☆';
            
            const namaPendek = (item.nama_perusahaan || '').substring(0, 20);

            const kodeHtml = `
                <div class="d-flex align-items-center">
                    <span class="${starClass} star-btn me-2" onclick="toggleWatchlist('${item.kode_saham}')">${starIcon}</span>
                    <div>
                        <span class="fw-bold kode-saham-btn" onclick="openPortfolioModal('${item.kode_saham}')">${item.kode_saham}</span>
                        <br><small class="text-muted" style="font-size:10px;">${namaPendek}</small>
                    </div>
                </div>
            `;

            // --- B. METRIK (Volume Pindah ke Tengah) ---
            if (currentFilter === 'OWNED' && item.isOwned && item.portfolio) {
                const pl = Number(item.portfolio.plPercent) || 0;
                const tpPct = item.portfolio.tpPct || 0;
                const clPct = item.portfolio.clPct || 0;
                const status = item.portfolio.status || 'HOLD';
                const color = pl >= 0 ? 'text-success' : 'text-danger';
                
                metricHtml = `
                    <div class="${color} fw-bold">${pl >= 0 ? '+' : ''}${fmtDec(pl)}%</div>
                    <small class="text-muted" style="font-size:10px">TP:${tpPct}% CL:${clPct}%</small>
                `;
                
                let sColor = 'bg-secondary';
                if (status.includes('TP')) sColor = 'bg-warning text-dark';
                else if (status.includes('CL')) sColor = 'bg-dark text-white';
                else if (status.includes('HOLD 🟢')) sColor = 'bg-success';
                else if (status.includes('HOLD 🔴')) sColor = 'bg-danger';
                
                badgeHtml = `<span class="badge ${sColor}">${status}</span>`;
                if (item.signal === 'ADD-ON 🔥') badgeHtml += `<br><span class="badge bg-primary mt-1" style="font-size:9px">ADD-ON 🔥</span>`;

            } else {
                const change = Number(item.change) || 0;
                const chgPercent = Number(item.chgPercent) || 0;
                const color = change >= 0 ? 'text-success' : 'text-danger';
                
                metricHtml = `<div class="${color} fw-bold">${change > 0 ? '+' : ''}${fmtDec(chgPercent)}%</div>`;
                
                const signal = item.signal || 'WAIT';
                if(signal === 'BUY') badgeHtml = `<span class="badge bg-success">BUY</span>`;
                else if(signal === 'SELL') badgeHtml = `<span class="badge bg-danger">SELL</span>`;
                else if(signal === 'RE-ENTRY?') badgeHtml = `<span class="badge bg-info text-dark">RE-ENTRY?</span>`;
                else badgeHtml = `<span class="badge bg-light text-secondary border">WAIT</span>`;
            }

            // --- C. ORDER KOLOM: Kode | Close | Volume | Chg/PL | Status ---
            row.innerHTML = `
                <td>${kodeHtml}</td>
                <td>${fmt(item.penutupan)}</td>
                <td class="text-end small">${fmt(item.volume)}</td> 
                <td class="text-end">${metricHtml}</td>
                <td class="text-center">${badgeHtml}</td>
            `;
            tableBody.appendChild(row);

        } catch (err) {
            console.error("Render error row:", err);
        }
    });

    footerInfo.innerText = `Menampilkan ${data.length} saham.`;
}

// ==========================================
// 7. WIDGET DASHBOARD
// ==========================================
function renderMarketOverview(data) {
    const widgetArea = document.getElementById('market-overview-area');
    const listGainers = document.getElementById('list-gainers');
    const listLosers = document.getElementById('list-losers');
    const listVolume = document.getElementById('list-volume');

    if (!data || data.length === 0) {
        if(widgetArea) widgetArea.style.display = 'none';
        return;
    }
    if(widgetArea) widgetArea.style.display = 'flex';

    const fmt = (n) => new Intl.NumberFormat('id-ID').format(n);
    const fmtDec = (n) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(n);

    // Top Gainers
    const topGainers = [...data].sort((a, b) => b.chgPercent - a.chgPercent).slice(0, 5);
    listGainers.innerHTML = topGainers.map(s => `
        <li class="list-group-item d-flex justify-content-between align-items-center py-1">
            <span class="fw-bold cursor-pointer text-primary" onclick="openPortfolioModal('${s.kode_saham}')">${s.kode_saham}</span>
            <span class="text-success fw-bold">+${fmtDec(s.chgPercent)}%</span>
        </li>`).join('');

    // Top Losers
    const topLosers = [...data].sort((a, b) => a.chgPercent - b.chgPercent).slice(0, 5);
    listLosers.innerHTML = topLosers.map(s => `
        <li class="list-group-item d-flex justify-content-between align-items-center py-1">
            <span class="fw-bold cursor-pointer text-primary" onclick="openPortfolioModal('${s.kode_saham}')">${s.kode_saham}</span>
            <span class="text-danger fw-bold">${fmtDec(s.chgPercent)}%</span>
        </li>`).join('');

    // Top Volume
    const topVolume = [...data].sort((a, b) => b.volume - a.volume).slice(0, 5);
    listVolume.innerHTML = topVolume.map(s => `
        <li class="list-group-item d-flex justify-content-between align-items-center py-1">
            <span class="fw-bold cursor-pointer text-primary" onclick="openPortfolioModal('${s.kode_saham}')">${s.kode_saham}</span>
            <span class="text-dark small">${fmt(s.volume)}</span>
        </li>`).join('');
}

// ==========================================
// 8. SORTING TABLE
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
        if (n === 0) {
            valA = valA.split('\n')[0].trim();
            valB = valB.split('\n')[0].trim();
        }
        const a = parseNum(valA);
        const b = parseNum(valB);
        if (a < b) return sortDir === 'asc' ? -1 : 1;
        if (a > b) return sortDir === 'asc' ? 1 : -1;
        return 0;
    });
    rows.forEach(row => tableBody.appendChild(row));
};

// ==========================================
// 9. CHART & MODAL LOGIC
// ==========================================
let portfolioModal; 
let strategyModal;
const STRATEGIES = {
    'conservative': { tp: 15, cl: 7, desc: "Cocok untuk Swing Trader. Target tinggi, toleransi risiko agak lebar." },
    'moderate':     { tp: 8,  cl: 4, desc: "Seimbang (Risk Reward 1:2). Cocok untuk day trading santai." },
    'aggressive':   { tp: 3,  cl: 2, desc: "Gaya Scalper. Cuan dikit bungkus, rugi dikit buang." }
};

const inputPreset = document.getElementById('strategy-preset');
const inputDefTp = document.getElementById('default-tp');
const inputDefCl = document.getElementById('default-cl');
const txtStratDesc = document.getElementById('strategy-desc');

// 1. Fungsi saat Dropdown Berubah
window.applyStrategyPreset = () => {
    const val = inputPreset.value;
    
    if (val === 'custom') {
        txtStratDesc.innerText = "Anda menentukan angka sendiri secara manual.";
        // Tidak mengubah angka input, biarkan user edit
    } else {
        const strat = STRATEGIES[val];
        if (strat) {
            inputDefTp.value = strat.tp;
            inputDefCl.value = strat.cl;
            txtStratDesc.innerText = strat.desc;
        }
    }
};

// 2. Buka Modal Strategy (Load Data)
window.openStrategyModal = () => {
    // Load angka yang tersimpan
    const savedTp = localStorage.getItem('def_tp');
    const savedCl = localStorage.getItem('def_cl');
    const savedPreset = localStorage.getItem('def_preset') || 'custom'; // Default custom

    // Set nilai ke input
    if(inputDefTp) inputDefTp.value = savedTp || '';
    if(inputDefCl) inputDefCl.value = savedCl || '';
    if(inputPreset) inputPreset.value = savedPreset;
    
    // Update deskripsi sesuai preset yang tersimpan
    if(savedPreset !== 'custom' && STRATEGIES[savedPreset]) {
        txtStratDesc.innerText = STRATEGIES[savedPreset].desc;
    }

    strategyModal.show();
};

// 3. Simpan Strategy
document.getElementById('strategy-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    
    // Simpan ke Browser
    localStorage.setItem('def_tp', inputDefTp.value);
    localStorage.setItem('def_cl', inputDefCl.value);
    localStorage.setItem('def_preset', inputPreset.value);
    
    strategyModal.hide();
    showAlert('success', `Strategi tersimpan! (TP: ${inputDefTp.value}%, CL: ${inputDefCl.value}%)`);
});
// --- CHART ---
async function loadAndRenderChart(kode) {
    const chartContainer = document.getElementById('price-chart');
    chartContainer.innerHTML = '<div class="spinner-border text-primary" role="status"></div>'; 

    const { data: history, error } = await db
        .from('history_saham')
        .select('tanggal_perdagangan_terakhir, open_price, tertinggi, terendah, penutupan')
        .eq('kode_saham', kode)
        .order('tanggal_perdagangan_terakhir', { ascending: true })
        .limit(60); 

    if (error || !history || history.length === 0) {
        chartContainer.innerHTML = '<small class="text-muted">Chart: Data history belum tersedia.</small>';
        return;
    }

    const seriesData = history.map(item => ({
        x: new Date(item.tanggal_perdagangan_terakhir).getTime(),
        y: [item.open_price, item.tertinggi, item.terendah, item.penutupan]
    }));

    const options = {
        series: [{ data: seriesData }],
        chart: { type: 'candlestick', height: 280, toolbar: { show: false }, fontFamily: 'sans-serif' },
        title: { text: `Grafik ${kode}`, align: 'left', style: { fontSize: '12px' } },
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

// --- PORTOFOLIO ---
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
    loadAndRenderChart(kode);
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

// ==========================================
// 10. CSV UPLOAD
// ==========================================
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
    
    // --- LANGKAH 1: CEK TANGGAL ---
    let shouldUpdateSnapshot = true; // Defaultnya update
    
    if (dataSaham.length > 0) {
        // Ambil tanggal dari baris pertama CSV
        const csvDateStr = dataSaham[0].tanggal_perdagangan_terakhir; 
        const csvDate = new Date(csvDateStr).getTime();

        // Ambil tanggal paling baru dari Database
        const { data: dbData, error } = await db
            .from('data_saham')
            .select('tanggal_perdagangan_terakhir')
            .order('tanggal_perdagangan_terakhir', { ascending: false })
            .limit(1);

        if (!error && dbData && dbData.length > 0) {
            const dbDateStr = dbData[0].tanggal_perdagangan_terakhir;
            const dbDate = new Date(dbDateStr).getTime();

            // BANDINGKAN: Jika data CSV lebih TUA dari data DB
            if (csvDate < dbDate) {
                shouldUpdateSnapshot = false;
                showAlert('info', `⚠️ <b>Mode Arsip:</b> Data yang diupload (${csvDateStr}) lebih lama dari data pasar saat ini (${dbDateStr}).<br>Tabel utama TIDAK akan diupdate, hanya disimpan ke History.`);
                // Beri jeda 3 detik biar user sempat baca notifnya
                await new Promise(r => setTimeout(r, 3000));
            } else {
                showAlert('info', `✅ Data Baru (${csvDateStr}). Mengupdate pasar...`);
            }
        }
    }

    const batchSize = 50; 
    let errorCount = 0;
    let errorMsg = '';
    
    // --- LANGKAH 2: UPDATE SNAPSHOT (HANYA JIKA DATA BARU) ---
    if (shouldUpdateSnapshot) {
        for (let i = 0; i < dataSaham.length; i += batchSize) {
            const batch = dataSaham.slice(i, i + batchSize);
            const percent = Math.round((i / dataSaham.length) * 50);
            showAlert('warning', `Update Pasar (Snapshot): ${percent}% ...`);
            
            const { error } = await db.from('data_saham').upsert(batch, { onConflict: 'kode_saham' });
            if (error) { errorCount++; errorMsg = error.message; }
        }
    }

    // --- LANGKAH 3: UPDATE HISTORY (SELALU JALAN - UNTUK ARSIP) ---
    // Kita tetap simpan ke history walaupun datanya jadul, buat menuhin chart.
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
        // Kalau snapshot di-skip, progress bar history mulai dari 0 sampai 100
        // Kalau snapshot jalan, history mulai dari 50 sampai 100
        const startPct = shouldUpdateSnapshot ? 50 : 0;
        const divider = shouldUpdateSnapshot ? 50 : 100;
        
        const percent = startPct + Math.round((i / historyData.length) * divider);
        showAlert('warning', `Arsip History: ${percent}% ...`);
        
        const { error } = await db.from('history_saham').upsert(batch, { onConflict: 'kode_saham, tanggal_perdagangan_terakhir' });
        if (error) { errorCount++; errorMsg = error.message; }
    }

    // --- FINALISASI ---
    if (errorCount === 0) {
        if (shouldUpdateSnapshot) {
            showAlert('success', 'SUKSES! Data Pasar & History diperbarui.');
        } else {
            showAlert('success', 'SUKSES! Data lama berhasil diarsipkan ke History (Data pasar tidak berubah).');
        }
        
        const csvInput = document.getElementById('csv-file-input');
        if(csvInput) csvInput.value = '';
        setTimeout(loadData, 2000);
    } else {
        showAlert('danger', `Gagal! Terjadi ${errorCount} error: ${errorMsg}`);
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
