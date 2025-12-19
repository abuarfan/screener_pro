// ==========================================
// 1. KONFIGURASI SUPABASE
// ==========================================
// Ganti dengan URL dan API Key proyek Supabase Anda
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

// Cek Sesi Login
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

// Listener Logout
document.getElementById('btn-logout')?.addEventListener('click', async () => {
    if(confirm("Logout?")) {
        await db.auth.signOut();
        window.location.href = 'login.html';
    }
});

// ==========================================
// 3. LOAD DATA (PASAR + PORTOFOLIO)
// ==========================================
async function loadData() {
    showAlert('primary', 'Sinkronisasi data...');
    
    // Ambil Data Market (Limit diperbesar agar muat semua saham)
    const marketReq = db.from('data_saham').select('*').order('kode_saham', { ascending: true }).limit(2000);
    // Ambil Data Portofolio User
    const portfolioReq = db.from('portfolio').select('*');

    const [marketRes, portfolioRes] = await Promise.all([marketReq, portfolioReq]);

    if (marketRes.error) {
        showAlert('danger', 'Gagal load: ' + marketRes.error.message);
        return;
    }

    allStocks = marketRes.data;
    myPortfolio = portfolioRes.data || [];

    applyFilterAndRender();
    
    if(allStocks.length > 0) {
        showAlert('success', `Data siap: ${allStocks.length} Emiten.`);
    } else {
        showAlert('warning', 'Data kosong. Silakan upload CSV Ringkasan Saham.');
    }
}

// ==========================================
// 4. CORE ENGINE: ANALISA & FILTER
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
        // Tampilkan yg dicentang watchlist ATAU yang punya barang (owned)
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

    // --- SETUP VARIABEL ---
    let signal = 'WAIT';
    let portfolioInfo = null;
    let isOwned = false;
    let isWatchlist = false;

    // --- 1. ANALISA MARKET (TECHNICAL SIMPLE) ---
    if (chgPercent >= 1) signal = 'BUY';
    else if (chgPercent <= -1) signal = 'SELL';
    
    // --- 2. ANALISA PORTOFOLIO (PERSONAL) ---
    if (ownedData) {
        isWatchlist = ownedData.is_watchlist; // Ambil status watchlist

        if (ownedData.lots > 0) {
            isOwned = true;
            const avgPrice = Number(ownedData.avg_price);
            const lots = Number(ownedData.lots);
            
            // Hitung Harga TP & CL berdasarkan Persen Inputan
            const tpPct = Number(ownedData.tp_pct) || 0;
            const clPct = Number(ownedData.cl_pct) || 0;
            
            const tpPrice = tpPct > 0 ? avgPrice * (1 + (tpPct/100)) : 0;
            const clPrice = clPct > 0 ? avgPrice * (1 - (clPct/100)) : 0;
            
            const marketVal = close * lots * 100; 
            const buyVal = avgPrice * lots * 100;
            const plVal = marketVal - buyVal;
            const plPercent = (plVal / buyVal) * 100;

            let actionStatus = 'HOLD';
            // Logika Status Aksi
            if (tpPrice > 0 && close >= tpPrice) actionStatus = 'DONE TP 💰';
            else if (clPrice > 0 && close <= clPrice) actionStatus = 'HIT CL ⚠️';
            else if (plPercent > 0) actionStatus = 'HOLD 🟢';
            else actionStatus = 'HOLD 🔴';

            // --- FITUR BARU: ADD-ON (PYRAMIDING) ---
            // Syarat: Sudah punya, Posisi Profit > 2%, dan Hari ini naik > 0.5%
            if (plPercent > 2 && chgPercent > 0.5) {
                signal = 'ADD-ON 🔥'; // Override sinyal market
            }

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
        change, chgPercent, signal, 
        isOwned, isWatchlist, portfolio: portfolioInfo 
    };
}

// ==========================================
// 5. RENDER TABLE (SAFE VERSION)
// ==========================================
const tableBody = document.getElementById('table-body');
const footerInfo = document.getElementById('footer-info');

function renderTable(data) {
    // 1. Bersihkan tabel
    tableBody.innerHTML = '';
    
    // 2. Cek jika data kosong
    if (!data || data.length === 0) {
        footerInfo.innerText = "Tidak ada data untuk ditampilkan.";
        return;
    }

    // 3. Loop Data dengan Try-Catch agar satu error tidak mematikan seluruh tabel
    data.forEach(item => {
        try {
            const row = document.createElement('tr');
            row.className = 'clickable-row'; 
            
            // Helper Formatter (Safe)
            const fmt = (n) => new Intl.NumberFormat('id-ID').format(Number(n) || 0);
            const fmtDec = (n) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(Number(n) || 0);

            let metricHtml = '';
            let badgeHtml = '';

            // --- A. KOLOM KODE & WATCHLIST ---
            const isWatchlist = item.isWatchlist || false;
            const starClass = isWatchlist ? 'text-warning' : 'text-secondary';
            const starIcon = isWatchlist ? '★' : '☆';
            
            // SAFE CHECK: Pastikan nama perusahaan ada, kalau null ganti string kosong
            const namaPerusahaan = (item.nama_perusahaan || '').toString();
            const namaPendek = namaPerusahaan.length > 20 ? namaPerusahaan.substring(0, 20) + '...' : namaPerusahaan;

            const kodeHtml = `
                <div class="d-flex align-items-center">
                    <span class="${starClass} star-btn me-2" onclick="toggleWatchlist('${item.kode_saham}')" title="Watchlist">${starIcon}</span>
                    <div>
                        <span class="fw-bold kode-saham-btn" onclick="openPortfolioModal('${item.kode_saham}')">${item.kode_saham}</span>
                        <br><small class="text-muted" style="font-size:10px;">${namaPendek}</small>
                    </div>
                </div>
            `;

            // --- B. KOLOM METRIK & STATUS ---
            // Cek apakah item ini Owned DAN object portfolio-nya benar-benar ada
            if (currentFilter === 'OWNED' && item.isOwned && item.portfolio) {
                // VIEW PORTOFOLIO
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
                
                // Cek Sinyal Add-on
                if (item.signal === 'ADD-ON 🔥') {
                    badgeHtml += `<br><span class="badge bg-primary mt-1" style="font-size:9px">ADD-ON 🔥</span>`;
                }

            } else {
                // VIEW MARKET (Default)
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

            // --- C. ISI ROW ---
            row.innerHTML = `
                <td>${kodeHtml}</td>
                <td>${fmt(item.penutupan)}</td>
                <td class="text-end">${metricHtml}</td>
                <td class="text-center">${badgeHtml}</td>
                <td class="text-end small">${fmt(item.volume)}</td>
            `;
            tableBody.appendChild(row);

        } catch (err) {
            console.error("Error merender baris:", item, err);
            // Skip baris yang error, lanjut ke baris berikutnya
        }
    });

    footerInfo.innerText = `Menampilkan ${data.length} saham.`;
}
// ==========================================
// UPDATE: MODAL LOGIC (TAMPILKAN NAMA PERUSAHAAN)
// ==========================================
// Pastikan variabel ini ada di bagian atas (DOM Elements)
const labelModalNama = document.getElementById('modal-nama-perusahaan'); 

window.openPortfolioModal = (kode) => {
    const stock = allStocks.find(s => s.kode_saham === kode);
    const owned = myPortfolio.find(p => p.kode_saham === kode);

    // Isi Header Modal
    labelModalKode.innerText = kode;
    // Tampilkan Nama Perusahaan di Modal (Handling jika stock undefined)
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
        formTpPct.value = '';
        formClPct.value = '';
        formNotes.value = '';
        checkWatchlist.checked = false;
        if(btnDelete) btnDelete.style.display = 'none';
    }
    updateCalc();
    portfolioModal.show();
};
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

        const parseNum = (str) => {
            const match = str.match(/[-+]?[0-9]*\.?[0-9]+/); 
            if(!match) return str; 
            let clean = match[0].replace(/\./g, '').replace(',', '.');
            const num = parseFloat(clean);
            return isNaN(num) ? str : num;
        };

        // Khusus kolom kode (index 0), buang bintangnya dulu
        if (n === 0) {
            valA = valA.split('\n')[0].trim(); // Ambil teks kode saja
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
// 7. MODAL & FORM LOGIC
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
const labelModalNama = document.getElementById('modal-nama-perusahaan');
const btnDelete = document.getElementById('btn-delete-portfolio');
const txtCalcTp = document.getElementById('calc-tp');
const txtCalcCl = document.getElementById('calc-cl');

// Kalkulator Otomatis (Saat input %)
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

// Buka Modal
window.openPortfolioModal = (kode) => {
    const stock = allStocks.find(s => s.kode_saham === kode);
    const owned = myPortfolio.find(p => p.kode_saham === kode);

    // Isi Header
    labelModalKode.innerText = kode;
    if(labelModalNama) labelModalNama.innerText = stock ? stock.nama_perusahaan : '';
    formKode.value = kode;
    
    // Isi Form
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
        formTpPct.value = '';
        formClPct.value = '';
        formNotes.value = '';
        checkWatchlist.checked = false;
        if(btnDelete) btnDelete.style.display = 'none';
    }
    updateCalc();
    portfolioModal.show();
};

// Toggle Bintang
window.toggleWatchlist = async (kode) => {
    const owned = myPortfolio.find(p => p.kode_saham === kode);
    const newStatus = owned ? !owned.is_watchlist : true;

    // Payload
    const payload = { user_id: currentUser.id, kode_saham: kode, is_watchlist: newStatus };
    if (!owned) { payload.avg_price = 0; payload.lots = 0; } // Default jika belum punya

    const { error } = await db.from('portfolio').upsert(payload, { onConflict: 'user_id, kode_saham' });
    if(!error) await loadData(); 
    else showAlert('danger', 'Gagal update watchlist');
};

// Simpan Data
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

// Hapus Data
btnDelete?.addEventListener('click', async () => {
    if(!confirm("Hapus dari portofolio?")) return;
    portfolioModal.hide();
    const { error } = await db.from('portfolio').delete().match({ user_id: currentUser.id, kode_saham: formKode.value });
    if(!error) { await loadData(); showAlert('success', 'Dihapus.'); }
});

// ==========================================
// 8. CSV UPLOAD (FULL MAPPING & HISTORY)
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

// Helper Alert
function showAlert(type, msg) {
    const alertBox = document.getElementById('status-alert');
    if(alertBox) {
        alertBox.className = `alert alert-${type}`;
        alertBox.innerHTML = msg;
        alertBox.classList.remove('d-none');
    }
}
