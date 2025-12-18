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

// Logout
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
    
    const marketReq = db.from('data_saham').select('*').order('kode_saham', { ascending: true }).limit(1000);
    const portfolioReq = db.from('portfolio').select('*');

    const [marketRes, portfolioRes] = await Promise.all([marketReq, portfolioReq]);

    if (marketRes.error) {
        showAlert('danger', 'Gagal load: ' + marketRes.error.message);
        return;
    }

    allStocks = marketRes.data;
    myPortfolio = portfolioRes.data || [];

    applyFilterAndRender();
    
    if(allStocks.length === 0) showAlert('warning', 'Data kosong. Upload CSV IDX.');
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

    let signal = 'NEUTRAL';
    let powerScore = 50;

    if (chgPercent >= 1) { signal = 'BUY'; powerScore = 75 + chgPercent; }
    else if (chgPercent <= -1) { signal = 'SELL'; powerScore = 25 + chgPercent; }

    powerScore = Math.min(Math.max(Math.round(powerScore), 0), 100);

    let portfolioInfo = null;
    if (ownedData) {
        const avgPrice = Number(ownedData.avg_price);
        const lots = Number(ownedData.lots);
        const marketVal = close * lots * 100; 
        const buyVal = avgPrice * lots * 100;
        const plVal = marketVal - buyVal;
        const plPercent = (plVal / buyVal) * 100;

        portfolioInfo = { avg: avgPrice, lots: lots, plVal: plVal, plPercent: plPercent };
    }

    return { ...stock, change, chgPercent, signal, powerScore, isOwned: !!ownedData, portfolio: portfolioInfo };
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
        if (currentFilter === 'OWNED' && item.isOwned) {
            const pl = item.portfolio.plPercent;
            const color = pl >= 0 ? 'text-success' : 'text-danger';
            metricHtml = `<div class="${color} fw-bold">${pl >= 0 ? '+' : ''}${fmtDec(pl)}%</div><small class="text-muted" style="font-size:10px">Avg: ${fmt(item.portfolio.avg)}</small>`;
        } else {
            const color = item.change >= 0 ? 'text-success' : 'text-danger';
            metricHtml = `<div class="${color} fw-bold">${item.change > 0 ? '+' : ''}${fmtDec(item.chgPercent)}%</div>`;
        }

        let signalBadge = `<span class="badge bg-secondary">WAIT</span>`;
        if(item.signal === 'BUY') signalBadge = `<span class="badge bg-success">BUY</span>`;
        if(item.signal === 'SELL') signalBadge = `<span class="badge bg-danger">SELL</span>`;

        const btnClass = item.isOwned ? 'btn-primary' : 'btn-outline-primary';
        const btnIcon = item.isOwned ? '✏️' : '+';

        row.innerHTML = `
            <td class="fw-bold">${item.kode_saham}</td>
            <td>${fmt(item.penutupan)}</td>
            <td class="text-end">${metricHtml}</td>
            <td class="text-center">${signalBadge}</td>
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
// 6. MODAL & SAVE
// ==========================================
let portfolioModal; 
try { portfolioModal = new bootstrap.Modal(document.getElementById('portfolioModal')); } catch(e) {}

const formKode = document.getElementById('input-kode');
const formAvg = document.getElementById('input-avg');
const formLots = document.getElementById('input-lots');
const labelModalKode = document.getElementById('modal-kode-saham');
const btnDelete = document.getElementById('btn-delete-portfolio');

window.openPortfolioModal = (kode) => {
    const stock = allStocks.find(s => s.kode_saham === kode);
    const owned = myPortfolio.find(p => p.kode_saham === kode);

    labelModalKode.innerText = kode;
    formKode.value = kode;
    if (owned) {
        formAvg.value = owned.avg_price;
        formLots.value = owned.lots;
        if(btnDelete) btnDelete.style.display = 'block';
    } else {
        formAvg.value = stock.penutupan;
        formLots.value = 1;
        if(btnDelete) btnDelete.style.display = 'none';
    }
    portfolioModal.show();
};

document.getElementById('portfolio-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    showAlert('info', 'Menyimpan...');
    portfolioModal.hide();
    const { error } = await db.from('portfolio').upsert({
        user_id: currentUser.id,
        kode_saham: formKode.value,
        avg_price: formAvg.value,
        lots: formLots.value
    }, { onConflict: 'user_id, kode_saham' });
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
// 7. CSV UPLOAD (COMPLETE MAPPING)
// ==========================================
const csvInput = document.getElementById('csv-file-input');
if (csvInput) {
    csvInput.addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (!file) return;

        showAlert('info', 'Membaca CSV...');

        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: async function(results) {
                const rawData = results.data;
                
                // MAPPING LENGKAP AGAR DATA TIDAK NULL
                const formattedData = rawData.map(row => {
                    // Helper case-insensitive
                    const findKey = (keys) => Object.keys(row).find(k => keys.some(w => k.toLowerCase().trim() === w.toLowerCase()));

                    // Cari Key berdasarkan Header CSV Anda
                    const kKode = findKey(['Kode Saham', 'Kode']) || 'Kode Saham';
                    const kNama = findKey(['Nama Perusahaan', 'Nama']) || 'Nama Perusahaan';
                    
                    // Harga
                    const kClose = findKey(['Penutupan', 'Close']) || 'Penutupan';
                    const kPrev = findKey(['Sebelumnya', 'Previous']) || 'Sebelumnya';
                    const kOpen = findKey(['Open Price', 'Open']) || 'Open Price';
                    const kHigh = findKey(['Tertinggi', 'High']) || 'Tertinggi';
                    const kLow = findKey(['Terendah', 'Low']) || 'Terendah';
                    
                    // Market Data
                    const kVol = findKey(['Volume']) || 'Volume';
                    const kVal = findKey(['Nilai', 'Value']) || 'Nilai';
                    const kFreq = findKey(['Frekuensi', 'Frequency']) || 'Frekuensi';
                    
                    // Bid/Offer
                    const kBid = findKey(['Bid']) || 'Bid';
                    const kBidVol = findKey(['Bid Volume']) || 'Bid Volume';
                    const kOffer = findKey(['Offer']) || 'Offer';
                    const kOfferVol = findKey(['Offer Volume']) || 'Offer Volume';
                    
                    // Asing
                    const kFSell = findKey(['Foreign Sell']) || 'Foreign Sell';
                    const kFBuy = findKey(['Foreign Buy']) || 'Foreign Buy';
                    
                    // Saham Beredar
                    const kListed = findKey(['Listed Shares']) || 'Listed Shares';

                    // Cleaner Angka (hapus koma)
                    const clean = (val) => {
                        if (!val) return 0;
                        if (typeof val === 'number') return val;
                        // Hapus karakter non-angka kecuali titik/minus
                        return parseFloat(val.toString().replace(/,/g, '')) || 0;
                    };

                    if(!row[kKode]) return null; // Skip baris kosong

                    // Construct Object Sesuai Struktur Database Supabase
                    return {
                        kode_saham: row[kKode],
                        nama_perusahaan: row[kNama] || '',
                        
                        // Harga
                        penutupan: clean(row[kClose]),
                        sebelumnya: clean(row[kPrev]),
                        open_price: clean(row[kOpen]),
                        tertinggi: clean(row[kHigh]),
                        terendah: clean(row[kLow]),
                        selisih: clean(row[kClose]) - clean(row[kPrev]),

                        // Transaksi
                        volume: clean(row[kVol]),
                        nilai: clean(row[kVal]),
                        frekuensi: clean(row[kFreq]),

                        // Order Book
                        bid: clean(row[kBid]),
                        bid_volume: clean(row[kBidVol]),
                        offer: clean(row[kOffer]),
                        offer_volume: clean(row[kOfferVol]),

                        // Foreign
                        foreign_sell: clean(row[kFSell]),
                        foreign_buy: clean(row[kFBuy]),
                        
                        // Shares
                        listed_shares: clean(row[kListed]),
                        
                        // Wajib tanggal hari ini
                        tanggal_perdagangan_terakhir: new Date().toISOString().split('T')[0]
                    };
                }).filter(item => item !== null && item.kode_saham !== 'UNKNOWN');

                if (formattedData.length > 0) {
                    await uploadToSupabase(formattedData);
                } else {
                    showAlert('danger', 'Gagal parsing CSV.');
                }
            }
        });
    });
}

async function uploadToSupabase(dataSaham) {
    showAlert('warning', `Mengupload ${dataSaham.length} data... Mohon tunggu.`);
    
    // Pecah menjadi batch agar tidak timeout (karena kolomnya banyak)
    // Supabase kadang menolak request yang terlalu besar sekaligus
    const batchSize = 100;
    let hasError = false;

    for (let i = 0; i < dataSaham.length; i += batchSize) {
        const batch = dataSaham.slice(i, i + batchSize);
        const { error } = await db.from('data_saham').upsert(batch, { onConflict: 'kode_saham' });
        
        if (error) {
            console.error("Batch Error:", error);
            hasError = true;
            showAlert('danger', 'Gagal di batch ' + i + ': ' + error.message);
            break;
        }
    }

    if (!hasError) {
        showAlert('success', 'Upload Selesai! Data Lengkap.');
        csvInput.value = '';
        setTimeout(loadData, 1500);
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
