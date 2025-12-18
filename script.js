// ==========================================
// 1. KONFIGURASI SUPABASE
// ==========================================
// Ganti dengan URL dan API Key proyek Supabase Anda
const supabaseUrl = 'https://mbccvmalvbdxbornqtqc.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1iY2N2bWFsdmJkeGJvcm5xdHFjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU5MDc1MzEsImV4cCI6MjA4MTQ4MzUzMX0.FicPHqOtziJuac5OrNvTc9OG7CEK4Bn_G9F9CYR-N3s';
const db = supabase.createClient(supabaseUrl, supabaseKey);

// ==========================================
// 2. SISTEM AUTH & GLOBAL VARIABLES
// ==========================================
let currentUser = null;
let allStocks = [];       
let myPortfolio = [];     
let currentFilter = 'ALL';

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
    
    // Load Data Saham (Limit 2000 agar muat semua)
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
    else showAlert('warning', 'Data kosong. Silakan upload CSV Ringkasan Saham.');
}

// ==========================================
// 4. ANALISA & FILTER
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

    let filteredData = [];
    if (currentFilter === 'ALL') {
        filteredData = processedData;
    } else if (currentFilter === 'WATCHLIST') {
        // Tampilkan yang dicentang watchlist OR yang punya barang
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

    // --- SINYAL MARKET UPDATE (Re-Entry Logic) ---
    let signal = 'WAIT';
    let powerScore = 50;

    if (chgPercent >= 1) { 
        signal = 'BUY'; 
        powerScore = 75 + chgPercent; 
    } else if (chgPercent <= -1) { 
        signal = 'SELL'; 
        powerScore = 25 + chgPercent; 
    } else if (chgPercent < 0 && chgPercent > -1) {
        // Turun tipis (0 s/d -1%)
        signal = 'RE-ENTRY?';
        powerScore = 60; 
    } else {
        signal = 'WAIT';
        powerScore = 50;
    }
    
    powerScore = Math.min(Math.max(Math.round(powerScore), 0), 100);

    // --- ANALISA PORTOFOLIO ---
    let portfolioInfo = null;
    let isOwned = false;
    let isWatchlist = false;

    if (ownedData) {
        isWatchlist = ownedData.is_watchlist; 

        // Hitung jika punya Lot (Owned)
        if (ownedData.lots > 0) {
            isOwned = true;
            const avgPrice = Number(ownedData.avg_price);
            const lots = Number(ownedData.lots);
            
            // Hitung TP/CL Price dari Persen
            const tpPct = Number(ownedData.tp_pct) || 0;
            const clPct = Number(ownedData.cl_pct) || 0;
            
            // Rumus: Avg * (1 + (Pct/100))
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

            portfolioInfo = { 
                avg: avgPrice, lots, 
                tpPct, clPct, 
                tpPrice, clPrice,
                notes: ownedData.notes,
                plPercent, status: actionStatus
            };
        }
    }

    return { 
        ...stock, 
        change, chgPercent, signal, powerScore, 
        isOwned, isWatchlist, portfolio: portfolioInfo 
    };
}

// ==========================================
// 5. RENDER TABEL
// ==========================================
const tableBody = document.getElementById('table-body');
const footerInfo = document.getElementById('footer-info');

function renderTable(data) {
    tableBody.innerHTML = '';
    
    data.forEach(item => {
        const row = document.createElement('tr');
        const fmt = (n) => new Intl.NumberFormat('id-ID').format(n);
        const fmtDec = (n) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(n);

        let metricHtml = '';
        let badgeHtml = '';

        // Tampilan Metrik (P/L atau Chg%)
        if (currentFilter === 'OWNED' && item.isOwned) {
            const pl = item.portfolio.plPercent;
            const color = pl >= 0 ? 'text-success' : 'text-danger';
            metricHtml = `
                <div class="${color} fw-bold">${pl >= 0 ? '+' : ''}${fmtDec(pl)}%</div>
                <small class="text-muted" style="font-size:10px">
                    TP: ${item.portfolio.tpPct}% | CL: ${item.portfolio.clPct}%
                </small>`;

            let sColor = 'bg-secondary';
            if (item.portfolio.status.includes('TP')) sColor = 'bg-warning text-dark';
            if (item.portfolio.status.includes('CL')) sColor = 'bg-dark text-white';
            if (item.portfolio.status.includes('HOLD 🟢')) sColor = 'bg-success';
            if (item.portfolio.status.includes('HOLD 🔴')) sColor = 'bg-danger';
            
            badgeHtml = `<span class="badge ${sColor}">${item.portfolio.status}</span>`;
            if(item.portfolio.notes) badgeHtml += `<br><small style="font-size:9px">📝 Catatan</small>`;

        } else {
            // Tampilan Market Biasa
            const color = item.change >= 0 ? 'text-success' : 'text-danger';
            metricHtml = `<div class="${color} fw-bold">${item.change > 0 ? '+' : ''}${fmtDec(item.chgPercent)}%</div>`;
            
            if(item.signal === 'BUY') badgeHtml = `<span class="badge bg-success">BUY</span>`;
            else if(item.signal === 'SELL') badgeHtml = `<span class="badge bg-danger">SELL</span>`;
            else if(item.signal === 'RE-ENTRY?') badgeHtml = `<span class="badge bg-info text-dark">RE-ENTRY?</span>`;
            else badgeHtml = `<span class="badge bg-secondary">WAIT</span>`;
        }

        // Tombol Aksi (Icon Bintang + Pensil)
        const starClass = item.isWatchlist ? 'text-warning' : 'text-secondary';
        const starIcon = item.isWatchlist ? '★' : '☆';
        const btnClass = item.isOwned ? 'btn-primary' : 'btn-outline-primary';
        const btnIcon = item.isOwned ? '✏️' : '+';

        row.innerHTML = `
            <td class="fw-bold">
                ${item.kode_saham}
                <span class="${starClass}" style="cursor:pointer; font-size:1.2em;" onclick="toggleWatchlist('${item.kode_saham}')">${starIcon}</span>
            </td>
            <td>${fmt(item.penutupan)}</td>
            <td class="text-end">${metricHtml}</td>
            <td class="text-center">${badgeHtml}</td>
            <td class="text-center">
                 <div class="progress" style="height: 5px; width: 50px; margin: auto;">
                    <div class="progress-bar ${item.powerScore > 50 ? 'bg-success' : 'bg-danger'}" style="width: ${item.powerScore}%"></div>
                </div>
            </td>
            <td class="text-end small">${fmt(item.volume)}</td>
            <td class="text-center">
                <button class="btn btn-sm ${btnClass}" onclick="openPortfolioModal('${item.kode_saham}')">${btnIcon}</button>
            </td>
        `;
        tableBody.appendChild(row);
    });

    footerInfo.innerText = `Menampilkan ${data.length} saham.`;
}

// ==========================================
// 6. SORTING TABLE
// ==========================================
let sortDir = 'asc';
window.sortTable = (n) => {
    sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    const rows = Array.from(tableBody.querySelectorAll('tr'));

    rows.sort((rowA, rowB) => {
        let valA = rowA.children[n].innerText.trim();
        let valB = rowB.children[n].innerText.trim();

        // Helper: Convert string tabel ke angka murni
        const parseNum = (str) => {
            const match = str.match(/[-+]?[0-9]*\.?[0-9]+/); 
            if(!match) return str; // Kalau tidak ada angka, return string
            let clean = match[0].replace(/\./g, '').replace(',', '.'); // Hapus titik ribuan, ganti koma desimal
            const num = parseFloat(clean);
            return isNaN(num) ? str : num;
        };

        if (n === 0) { // Kolom Kode
            valA = valA.split(' ')[0]; // Ambil kodenya saja (buang bintang)
            valB = valB.split(' ')[0];
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
// 7. MODAL, WATCHLIST & PLAN %
// ==========================================
let portfolioModal; 
try { portfolioModal = new bootstrap.Modal(document.getElementById('portfolioModal')); } catch(e) {}

const formKode = document.getElementById('input-kode');
const formAvg = document.getElementById('input-avg');
const formLots = document.getElementById('input-lots');
const formTpPct = document.getElementById('input-tp-pct');
const formClPct = document.getElementById('input-cl-pct');
const formNotes = document.getElementById('input-notes');
const checkWatchlist = document.getElementById('input-watchlist');
const labelModalKode = document.getElementById('modal-kode-saham');
const btnDelete = document.getElementById('btn-delete-portfolio');

const txtCalcTp = document.getElementById('calc-tp');
const txtCalcCl = document.getElementById('calc-cl');

// Kalkulasi Realtime
function updateCalc() {
    const avg = parseFloat(formAvg.value) || 0;
    const tpPct = parseFloat(formTpPct.value) || 0;
    const clPct = parseFloat(formClPct.value) || 0;

    const tpPrice = Math.round(avg * (1 + tpPct/100));
    const clPrice = Math.round(avg * (1 - clPct/100));

    txtCalcTp.innerText = tpPct > 0 ? `Target Harga: Rp ${new Intl.NumberFormat('id-ID').format(tpPrice)}` : 'Target: -';
    txtCalcCl.innerText = clPct > 0 ? `Stop Harga: Rp ${new Intl.NumberFormat('id-ID').format(clPrice)}` : 'Stop: -';
}
formAvg.addEventListener('input', updateCalc);
formTpPct.addEventListener('input', updateCalc);
formClPct.addEventListener('input', updateCalc);

window.openPortfolioModal = (kode) => {
    const stock = allStocks.find(s => s.kode_saham === kode);
    const owned = myPortfolio.find(p => p.kode_saham === kode);

    labelModalKode.innerText = kode;
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
        formAvg.value = stock.penutupan;
        formLots.value = 1;
        formTpPct.value = '';
        formClPct.value = '';
        formNotes.value = '';
        checkWatchlist.checked = false;
        if(btnDelete) btnDelete.style.display = 'none';
    }
    updateCalc();
    portfolioModal.show();
};

window.toggleWatchlist = async (kode) => {
    const owned = myPortfolio.find(p => p.kode_saham === kode);
    const newStatus = owned ? !owned.is_watchlist : true;

    const payload = {
        user_id: currentUser.id,
        kode_saham: kode,
        is_watchlist: newStatus
    };
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
    if(!confirm("Hapus dari portofolio?")) return;
    portfolioModal.hide();
    const { error } = await db.from('portfolio').delete().match({ user_id: currentUser.id, kode_saham: formKode.value });
    if(!error) { await loadData(); showAlert('success', 'Dihapus.'); }
});

// ==========================================
// 8. CSV UPLOAD (MAPPING LENGKAP & HISTORY)
// ==========================================
const csvInput = document.getElementById('csv-file-input');
if (csvInput) {
    csvInput.addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (!file) return;
        showAlert('info', 'Parsing CSV (Mode Lengkap)...');

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
    showAlert('warning', `Sedang memproses ${dataSaham.length} data...`);
    const batchSize = 50; 
    let errorCount = 0;
    
    // 1. UPDATE SNAPSHOT (DATA TERKINI)
    for (let i = 0; i < dataSaham.length; i += batchSize) {
        const batch = dataSaham.slice(i, i + batchSize);
        const { error } = await db.from('data_saham').upsert(batch, { onConflict: 'kode_saham' });
        if (error) errorCount++;
    }

    // 2. ARSIP HISTORY
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
        const { error } = await db.from('history_saham').upsert(batch, { onConflict: 'kode_saham, tanggal_perdagangan_terakhir' });
        if (error) errorCount++;
    }

    if (errorCount === 0) {
        showAlert('success', 'SUKSES! Data Snapshot & History diperbarui.');
        const csvInput = document.getElementById('csv-file-input');
        if(csvInput) csvInput.value = '';
        setTimeout(loadData, 1500);
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
