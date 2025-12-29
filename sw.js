const CACHE_NAME = 'rifqymusic-static-v1'; // Cache untuk index.html, css, js
const DYNAMIC_CACHE = 'rifqymusic-songs-v1'; // Cache KHUSUS untuk lagu
let isSmartOfflineEnabled = false; // Status default (dikontrol oleh script.js)

// Daftar file inti yang wajib jalan saat offline
const STATIC_ASSETS = [
    './',
    './index.html',
    './script.js',
    './style.css',
    'https://fonts.googleapis.com/icon?family=Material+Icons+Round' // Icon
];

// 1. INSTALL SERVICE WORKER
// Saat pertama kali website dibuka, simpan file inti (HTML/JS/CSS)
self.addEventListener('install', event => {
    // Paksa SW baru untuk segera aktif
    self.skipWaiting();
    
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            console.log('[SW] Caching App Shell');
            return cache.addAll(STATIC_ASSETS);
        })
    );
});

// 2. ACTIVATE SERVICE WORKER
// Bersihkan cache lama jika ada update versi baru
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys => {
            return Promise.all(keys.map(key => {
                if (key !== CACHE_NAME && key !== DYNAMIC_CACHE) {
                    console.log('[SW] Deleting old cache:', key);
                    return caches.delete(key);
                }
            }));
        })
    );
    return self.clients.claim();
});

// 3. LISTEN PESAN DARI SCRIPT.JS (TOMBOL ON/OFF)
self.addEventListener('message', event => {
    if (event.data && event.data.action === 'toggleOffline') {
        isSmartOfflineEnabled = event.data.status;
        console.log('[SW] Smart Offline Mode:', isSmartOfflineEnabled ? 'ON' : 'OFF');
        
        // Jika user mematikan fitur, kita bisa opsional membersihkan cache lagu
        if (!isSmartOfflineEnabled) {
            // Uncomment baris di bawah jika ingin otomatis hapus lagu saat dimatikan
            // caches.delete(DYNAMIC_CACHE);
        }
    }
});

// 4. FETCH STRATEGY (LOGIKA UTAMA)
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    // --- STRATEGI A: KHUSUS FILE LAGU (AUDIO) ---
    // Cek apakah request mengandung '/songs/' DAN berakhiran mp3/flac
    if (url.pathname.includes('/songs/') && (url.pathname.endsWith('.mp3') || url.pathname.endsWith('.flac'))) {
        event.respondWith(
            caches.open(DYNAMIC_CACHE).then(cache => {
                return cache.match(event.request).then(cachedResponse => {
                    // Skenario 1: Lagu sudah ada di Cache? Putar langsung (Offline/Online sama saja)
                    if (cachedResponse) {
                        return cachedResponse;
                    }

                    // Skenario 2: Lagu belum ada. Ambil dari Internet.
                    return fetch(event.request).then(networkResponse => {
                        // Cek apakah fitur Smart Offline ON?
                        if (isSmartOfflineEnabled) {
                            // Jika ON, simpan hasil download ke Cache
                            cache.put(event.request, networkResponse.clone());
                        }
                        return networkResponse;
                    }).catch(() => {
                        // Skenario 3: Internet Mati & Lagu gak ada di cache
                        console.log('[SW] Gagal memutar lagu (Offline & Not Cached)');
                    });
                });
            })
        );
        return; // Stop, jangan jalankan kode di bawah
    }

    // --- STRATEGI B: FILE LAINNYA (HTML, CSS, GAMBAR) ---
    // Coba ambil dari Cache dulu, kalau gak ada baru internet (Cache First)
    event.respondWith(
        caches.match(event.request).then(response => {
            return response || fetch(event.request);
        })
    );
});
