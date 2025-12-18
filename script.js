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

const btnLogout = document.getElementById('btn-logout');
if(btnLogout) {
    btnLogout.addEventListener('click', async () => {
        if(confirm("Logout?")) {
            await db.auth.signOut();
            window.location.href = 'login.html';
        }
    });
}

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
    
    if(allStocks.length === 0) showAlert('warning', 'Data kosong. Upload CSV Ringkasan Saham.');
    else showAlert('success', `Data: ${allStocks.length} Emiten.`);
}

// ==========================================
// 4. ANALISA & RENDER
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
    if (currentFilter === 'ALL') filteredData = processedData;
    else if (currentFilter === 'BUY') filteredData = processedData.filter(s => s.signal === 'BUY');
    else if (currentFilter === 'SELL') filteredData = processedData.filter(s => s.signal === 'SELL');
    else if (currentFilter === 'OWNED') filteredData = processedData.filter(s => s.isOwned);

    renderTable(filteredData);
}

function analyzeStock(stock, ownedData) {
    const close = Number(stock.penutupan) || 0;
    const prev = Number(stock.sebelumnya) || close;
    
    const change = close - prev;
    const chgPercent = prev === 0 ? 0 : (change / prev) * 100;

    // --- ANALISA MARKET (Sinyal Umum) ---
    let signal = 'NEUTRAL';
    let powerScore = 50;

    if (chgPercent >= 1) { signal = 'BUY'; powerScore = 75 + chgPercent; }
    else if (chgPercent <= -1) { signal = 'SELL'; powerScore = 25 + chgPercent; }
    powerScore = Math.min(Math.max(Math.round(powerScore), 0), 100);

    // --- ANALISA PORTOFOLIO (Personal) ---
    let portfolioInfo = null;
    let actionStatus = ''; // Status Aksi (TP/CL)

    if (ownedData) {
        const avgPrice = Number(ownedData.avg_price);
        const lots = Number(ownedData.lots);
        const tp = Number(ownedData.target_price) || 0; // Ambil TP
        const cl = Number(ownedData.stop_loss) || 0;    // Ambil CL
        
        const marketVal = close * lots * 100; 
        const buyVal = avgPrice * lots * 100;
        const plVal = marketVal - buyVal;
        const plPercent = (plVal / buyVal) * 100;

        // Logika Status Aksi
        if (tp > 0 && close >= tp) actionStatus = 'DONE TP 💰';
        else if (cl > 0 && close <= cl) actionStatus = 'HIT CL ⚠️';
        else if (plPercent > 0) actionStatus = 'HOLD 🟢';
        else actionStatus = 'HOLD 🔴';

        portfolioInfo = { 
            avg: avgPrice, 
            lots: lots, 
            tp: tp, 
            cl: cl, 
            notes: ownedData.notes,
            plVal: plVal, 
            plPercent: plPercent,
            status: actionStatus
        };
    }

    return { 
        ...stock, 
        change, 
        chgPercent, 
        signal, 
        powerScore, 
        isOwned: !!ownedData, 
        portfolio: portfolioInfo 
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

        if (currentFilter === 'OWNED' && item.isOwned) {
            // MODE PORTOFOLIO: Tampilkan P/L dan Status Aksi
            const pl = item.portfolio.plPercent;
            const color = pl >= 0 ? 'text-success' : 'text-danger';
            
            metricHtml = `
                <div class="${color} fw-bold">${pl >= 0 ? '+' : ''}${fmtDec(pl)}%</div>
                <small class="text-muted" style="font-size:10px">
                    Avg: ${fmt(item.portfolio.avg)} <br>
                    TP: ${item.portfolio.tp || '-'} | CL: ${item.portfolio.cl || '-'}
                </small>
            `;

            // Badge Status Aksi (TP/CL/Hold)
            let statusColor = 'bg-secondary';
            if (item.portfolio.status.includes('TP')) statusColor = 'bg-warning text-dark';
            if (item.portfolio.status.includes('CL')) statusColor = 'bg-dark';
            if (item.portfolio.status === 'HOLD 🟢') statusColor = 'bg-success';
            if (item.portfolio.status === 'HOLD 🔴') statusColor = 'bg-danger';

            badgeHtml = `<span class="badge ${statusColor}">${item.portfolio.status}</span>`;
            
            // Tampilkan notes jika ada (tooltip sederhana)
            if(item.portfolio.notes) {
                badgeHtml += `<br><small class="text-muted d-block text-truncate" style="max-width: 80px;">📝 ${item.portfolio.notes}</small>`;
            }

        } else {
            // MODE BIASA: Tampilkan Chg% dan Sinyal Market
            const color = item.change >= 0 ? 'text-success' : 'text-danger';
            metricHtml = `<div class="${color} fw-bold">${item.change > 0 ? '+' : ''}${fmtDec(item.chgPercent)}%</div>`;
            
            if(item.signal === 'BUY') badgeHtml = `<span class="badge bg-success">BUY</span>`;
            else if(item.signal === 'SELL') badgeHtml = `<span class="badge bg-danger">SELL</span>`;
            else badgeHtml = `<span class="badge bg-secondary">WAIT</span>`;
        }

        const btnClass = item.isOwned ? 'btn-primary' : 'btn-outline-primary';
        const btnIcon = item.isOwned ? '✏️' : '+';

        row.innerHTML = `
            <td class="fw-bold">${item.kode_saham}</td>
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
// 6. MODAL & SAVE PORTOFOLIO
// ==========================================
let portfolioModal; 
try { portfolioModal = new bootstrap.Modal(document.getElementById('portfolioModal')); } catch(e) {}

const formKode = document.getElementById('input-kode');
const formAvg = document.getElementById('input-avg');
const formLots = document.getElementById('input-lots');
const formTp = document.getElementById('input-tp'); // Baru
const formCl = document.getElementById('input-cl'); // Baru
const formNotes = document.getElementById('input-notes'); // Baru

const labelModalKode = document.getElementById('modal-kode-saham');
const btnDelete = document.getElementById('btn-delete-portfolio');

window.openPortfolioModal = (kode) => {
    const stock = allStocks.find(s => s.kode_saham === kode);
    const owned = myPortfolio.find(p => p.kode_saham === kode);

    labelModalKode.innerText = kode;
    formKode.value = kode;
    
    if (owned) {
        // Mode Edit
        formAvg.value = owned.avg_price;
        formLots.value = owned.lots;
        formTp.value = owned.target_price || ''; // Load TP
        formCl.value = owned.stop_loss || '';    // Load CL
        formNotes.value = owned.notes || '';     // Load Notes
        if(btnDelete) btnDelete.style.display = 'block';
    } else {
        // Mode Baru
        formAvg.value = stock.penutupan;
        formLots.value = 1;
        formTp.value = '';
        formCl.value = '';
        formNotes.value = '';
        if(btnDelete) btnDelete.style.display = 'none';
    }
    portfolioModal.show();
};

document.getElementById('portfolio-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    showAlert('info', 'Menyimpan rencana trading...');
    portfolioModal.hide();

    const { error } = await db.from('portfolio').upsert({
        user_id: currentUser.id,
        kode_saham: formKode.value,
        avg_price: formAvg.value,
        lots: formLots.value,
        target_price: formTp.value || 0, // Simpan TP
        stop_loss: formCl.value || 0,    // Simpan CL
        notes: formNotes.value           // Simpan Notes
    }, { onConflict: 'user_id, kode_saham' });

    if (error) showAlert('danger', error.message);
    else { await loadData(); showAlert('success', 'Portofolio & Plan tersimpan!'); }
});

btnDelete?.addEventListener('click', async () => {
    if(!confirm("Hapus dari portofolio?")) return;
    portfolioModal.hide();
    const { error } = await db.from('portfolio').delete().match({ user_id: currentUser.id, kode_saham: formKode.value });
    if(!error) { await loadData(); showAlert('success', 'Dihapus.'); }
});

// ==========================================
// 7. CSV UPLOAD (FULL MAPPING) - Tetap sama
// ==========================================
const csvInput = document.getElementById('csv-file-input');
if (csvInput) {
    csvInput.addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (!file) return;
        showAlert('info', 'Parsing CSV...');

        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
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
                else showAlert('danger', 'Gagal membaca CSV.');
            }
        });
    });
}

async function uploadToSupabase(dataSaham) {
    showAlert('warning', `Sedang memproses ${dataSaham.length} data...`);
    const batchSize = 50; 
    let errorCount = 0;
    
    // 1. UPDATE SNAPSHOT
    for (let i = 0; i < dataSaham.length; i += batchSize) {
        const batch = dataSaham.slice(i, i + batchSize);
        const percent = Math.round((i / dataSaham.length) * 50);
        showAlert('warning', `Upload Data Terkini: ${percent}% ...`);
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
        const percent = 50 + Math.round((i / historyData.length) * 50);
        showAlert('warning', `Arsip History: ${percent}% ...`);
        const { error } = await db.from('history_saham').upsert(batch, { onConflict: 'kode_saham, tanggal_perdagangan_terakhir' });
        if (error) errorCount++;
    }

    if (errorCount === 0) {
        showAlert('success', 'SUKSES! Data Snapshot & History diperbarui.');
        const csvInput = document.getElementById('csv-file-input');
        if(csvInput) csvInput.value = '';
        setTimeout(loadData, 1500);
    } else {
        showAlert('danger', `Selesai dengan ${errorCount} error.`);
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
