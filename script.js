const CONFIG = {
    user: 'rydevs29',
    repo: 'RifqyMusic',
    basePath: 'songs',
    folders: ['lossless', 'med', 'low'] 
};

// --- ULTIMATE AUDIO ENGINE (WEB AUDIO API) ---
let audioCtx, source;
// Node Audio FX
let eqBands = []; 
let reverbNode, reverbGainNode; 
let monoMergerNode, masterGainNode; 
let boosterNode; 
let compressorNode; // Peak Normalization

// [NOTE] Visualizer Variables (analyzer, canvas, ctx) SUDAH DIHAPUS.

// --- [NEW] FEATURE VARIABLES ---
let pannerNode; // Untuk 8D Audio
let pannerInterval; // Timer animasi 8D
let soundscapeAudio = new Audio(); // Player khusus suara alam
let soundscapeGainNode; // Volume suara alam

// DYNAMIC VOLUME VARIABLES
let isDynamicVol = false;
let micStream = null;
let micAnalyzer = null;

// [NEW] TRANSLATE VARIABLES
let isTranslateEnabled = false;
let lastLyricsText = "";

// [NEW] PREMIUM THEME VARIABLES
let dynamicThemeEnabled = false;

// Status FX & App
let is3D = false;
let is8D = false; 
let isMono = false;
let isPeak = false;
let isCrossfade = false;
let isLiteMode = false; 
let isOfflineMode = localStorage.getItem('isSmartOffline') === 'true'; 
let currentQuality = 'Hi-Fi'; 
// let isVisualizerEnabled = true; // DIHAPUS
let playbackSpeed = 1.0;
let sleepTimer = null;
let wakeLock = null; // Optimasi APK

const audioPlayer = new Audio();
audioPlayer.crossOrigin = "anonymous"; 
soundscapeAudio.crossOrigin = "anonymous"; 
soundscapeAudio.loop = true; 

// UI Elements
const homeList = document.getElementById('home-list');
const savedList = document.getElementById('saved-list');
const fullPlayer = document.getElementById('view-player');
const miniPlayer = document.getElementById('mini-player');
const searchInput = document.getElementById('search-input');
const fullTitle = document.getElementById('full-title');
const fullArtist = document.getElementById('full-artist');
const fullCover = document.getElementById('full-cover');
const progressBar = document.getElementById('progress-bar');
const currentTimeEl = document.getElementById('current-time');
const durationEl = document.getElementById('duration');

// State App
let allSongs = [];
let savedSongs = JSON.parse(localStorage.getItem('savedSongs')) || [];
let currentIndex = 0;
let isShuffle = false;
let isRepeat = false;
let lyricsData = []; 

// --- OPTIMASI APK: WAKE LOCK & BACKGROUND ---
const requestWakeLock = async () => {
    try {
        if ('wakeLock' in navigator) {
            wakeLock = await navigator.requestWakeLock('screen');
        }
    } catch (err) { console.log('WakeLock system prevented'); }
};
audioPlayer.addEventListener('play', requestWakeLock);

// --- SERVICE WORKER REGISTRATION (Smart Offline) ---
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js')
        .then(reg => console.log('Service Worker Registered', reg))
        .catch(err => console.log('SW Registration Failed', err));
}

// --- INITIALIZATION ---
async function init() {
    try {
        const fetchPromises = CONFIG.folders.map(async folder => {
            const url = `https://api.github.com/repos/${CONFIG.user}/${CONFIG.repo}/contents/${CONFIG.basePath}/${folder}?t=${Date.now()}`;
            const res = await fetch(url);
            if (!res.ok) return [];
            const files = await res.json();
            return Array.isArray(files) ? files.map(f => ({ 
                name: f.name, 
                originalFolder: folder,
                folderPath: `${CONFIG.basePath}/${folder}`
            })) : [];
        });

        const results = await Promise.all(fetchPromises);
        const rawSongs = results.flat().filter(f => f.name.toLowerCase().endsWith('.flac') || f.name.toLowerCase().endsWith('.mp3'));

        const uniqueSongs = [];
        const seenNames = new Set();
        for (const s of rawSongs) {
            if (!seenNames.has(s.name)) {
                seenNames.add(s.name);
                uniqueSongs.push(s);
            }
        }
        
        allSongs = uniqueSongs;

        if (allSongs.length > 0) {
            document.getElementById('loading-text').style.display = 'none';
            renderHomeList(allSongs);
            renderSavedList();
            const offlineToggle = document.getElementById('btn-smart-offline');
            if(offlineToggle) offlineToggle.checked = isOfflineMode;
        } else {
            document.getElementById('loading-text').innerText = "Library Kosong.";
        }
    } catch (e) {
        document.getElementById('loading-text').innerText = "Error: " + e.message;
    }
}

// --- SETUP AUDIO ENGINE (CLEANED - NO ANALYZER) ---
function initAudioEngine() {
    if (audioCtx) return; 
    
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        audioCtx = new AudioContext();
        source = audioCtx.createMediaElementSource(audioPlayer);

        // SOUNDSCAPE NODE
        const soundscapeSource = audioCtx.createMediaElementSource(soundscapeAudio);
        soundscapeGainNode = audioCtx.createGain();
        soundscapeGainNode.gain.value = 0.5; 
        soundscapeSource.connect(soundscapeGainNode);
        soundscapeGainNode.connect(audioCtx.destination); 

        // 1. EQUALIZER
        const freqs = [60, 250, 1000, 4000, 16000];
        eqBands = freqs.map(f => {
            const filter = audioCtx.createBiquadFilter();
            filter.type = 'peaking';
            filter.frequency.value = f;
            filter.gain.value = 0; 
            return filter;
        });

        // 2. 8D AUDIO
        pannerNode = audioCtx.createStereoPanner(); 
        pannerNode.pan.value = 0;

        // 3. PEAK NORMALIZATION
        compressorNode = audioCtx.createDynamicsCompressor();
        compressorNode.threshold.setValueAtTime(-24, audioCtx.currentTime);
        compressorNode.knee.setValueAtTime(40, audioCtx.currentTime);
        compressorNode.ratio.setValueAtTime(12, audioCtx.currentTime);
        compressorNode.attack.setValueAtTime(0, audioCtx.currentTime);
        compressorNode.release.setValueAtTime(0.25, audioCtx.currentTime);

        // 4. REVERB
        reverbNode = audioCtx.createConvolver();
        reverbGainNode = audioCtx.createGain();
        reverbGainNode.gain.value = 0; 
        
        const length = audioCtx.sampleRate * 1;
        const impulse = audioCtx.createBuffer(2, length, audioCtx.sampleRate);
        for (let i = 0; i < length; i++) {
            const decay = Math.pow(1 - i / length, 2);
            impulse.getChannelData(0)[i] = (Math.random() * 2 - 1) * decay;
            impulse.getChannelData(1)[i] = (Math.random() * 2 - 1) * decay;
        }
        reverbNode.buffer = impulse;

        // 5. GAIN NODES
        boosterNode = audioCtx.createGain();
        boosterNode.gain.value = 1; 
        masterGainNode = audioCtx.createGain(); 
        monoMergerNode = audioCtx.createChannelMerger(1); 

        // [DIHAPUS] Analyzer & Visualizer Connection

        // ROUTING CHAIN
        let chain = source;
        eqBands.forEach(band => { chain.connect(band); chain = band; });
        
        chain.connect(pannerNode);
        pannerNode.connect(boosterNode);
        
        boosterNode.connect(reverbNode);
        reverbNode.connect(reverbGainNode);
        reverbGainNode.connect(compressorNode);
        
        boosterNode.connect(compressorNode);
        compressorNode.connect(masterGainNode);
        
        // Connect ke Output (bypass analyzer)
        connectFinalOutput(); 
        
        console.log("Audio Engine Ready (No Visualizer)!");

    } catch (e) {
        console.error("Audio Engine Error:", e);
    }
}

function connectFinalOutput() {
    masterGainNode.disconnect();
    monoMergerNode.disconnect();
    if (isMono) {
        masterGainNode.connect(monoMergerNode);
        monoMergerNode.connect(audioCtx.destination);
    } else {
        masterGainNode.connect(audioCtx.destination);
    }
}

// [NOTE] Fungsi initVisualizerCanvas, drawVisualizer, toggleVisualizer SUDAH DIHAPUS.

// --- FEATURES LOGIC ---

// 1. SMART OFFLINE CACHE
function toggleSmartOffline() {
    isOfflineMode = document.getElementById('btn-smart-offline').checked;
    localStorage.setItem('isSmartOffline', isOfflineMode);
    
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({
            action: 'toggleOffline',
            status: isOfflineMode
        });
    }
    
    if(isOfflineMode) {
        alert("Smart Offline ON: Lagu akan disimpan otomatis.");
    } else {
        if(confirm("Hapus semua lagu offline?")) {
            caches.delete('rifqymusic-songs-v1');
            alert("Cache dihapus.");
        }
    }
}

// 2. 8D AUDIO
function toggle8D() {
    is8D = document.getElementById('btn-8d').checked;
    if (!audioCtx) initAudioEngine();
    
    if (is8D) {
        if(is3D) { 
            document.getElementById('btn-3d').checked = false;
            reverbGainNode.gain.setTargetAtTime(0, audioCtx.currentTime, 0.1);
            is3D = false;
        }

        let time = 0;
        pannerInterval = setInterval(() => {
            const x = Math.sin(time); 
            pannerNode.pan.value = x;
            time += 0.05; 
        }, 50); 
        
    } else {
        clearInterval(pannerInterval);
        pannerNode.pan.setTargetAtTime(0, audioCtx.currentTime, 0.5); 
    }
}

// 3. SOUNDSCAPE
function toggleSoundscape(type) {
    if (!audioCtx) initAudioEngine();
    if (type === 'off') {
        soundscapeAudio.pause();
        return;
    }
    let src = '';
    if(type === 'rain') src = 'https://actions.google.com/sounds/v1/weather/rain_heavy_loud.ogg';
    if(type === 'fire') src = 'https://actions.google.com/sounds/v1/ambiences/fire.ogg';
    if(type === 'cafe') src = 'https://actions.google.com/sounds/v1/ambiences/coffee_shop.ogg';
    
    soundscapeAudio.src = src;
    soundscapeAudio.play();
}

function setSoundscapeVolume(val) {
    if(soundscapeGainNode) soundscapeGainNode.gain.value = val;
}

// 4. DYNAMIC AUDIO NORMALIZATION (Ambient Sense)
async function toggleDynamicVol() {
    isDynamicVol = document.getElementById('btn-dynamic-vol').checked;
    
    if (isDynamicVol) {
        try {
            micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const micCtx = new (window.AudioContext || window.webkitAudioContext)();
            const micSource = micCtx.createMediaStreamSource(micStream);
            micAnalyzer = micCtx.createAnalyser();
            micAnalyzer.fftSize = 256;
            micSource.connect(micAnalyzer);
            
            detectNoise(); 
            alert("Ambient Sense Aktif.");
        } catch (e) {
            console.error("Mic error:", e);
            alert("Butuh izin mikrofon.");
            document.getElementById('btn-dynamic-vol').checked = false;
        }
    } else {
        if (micStream) {
            micStream.getTracks().forEach(track => track.stop());
            if(masterGainNode) masterGainNode.gain.setTargetAtTime(1, audioCtx.currentTime, 0.5);
        }
    }
}

function detectNoise() {
    if (!isDynamicVol || !micAnalyzer) return;

    const bufferLength = micAnalyzer.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    micAnalyzer.getByteFrequencyData(dataArray);

    let sum = 0;
    for (let i = 0; i < bufferLength; i++) {
        sum += dataArray[i];
    }
    const average = sum / bufferLength;

    if (average > 40) {
        masterGainNode.gain.setTargetAtTime(1.5, audioCtx.currentTime, 0.5); 
    } else {
        masterGainNode.gain.setTargetAtTime(1.0, audioCtx.currentTime, 0.5); 
    }

    requestAnimationFrame(detectNoise);
}

// --- EXISTING FX ---
function toggleLiteMode() {
    isLiteMode = document.getElementById('btn-litemode').checked;
    if (isLiteMode) {
        // [DIHAPUS] Referensi ke Visualizer
        if(reverbGainNode) reverbGainNode.gain.setTargetAtTime(0, audioCtx.currentTime, 0.1);
        document.body.classList.add('lite-version'); 
        
        document.getElementById('btn-3d').checked = false;
        if(is8D) {
            document.getElementById('btn-8d').checked = false;
            toggle8D();
        }
        alert("Lite Mode Aktif.");
    } else {
        document.body.classList.remove('lite-version');
        alert("Lite Mode Mati.");
    }
}

function togglePeak() {
    isPeak = document.getElementById('btn-peak').checked;
    if(compressorNode) {
        compressorNode.threshold.setTargetAtTime(isPeak ? -10 : -50, audioCtx.currentTime, 0.1);
    }
}

function toggleCrossfade() {
    isCrossfade = document.getElementById('btn-crossfade').checked;
}

function toggle3D() {
    is3D = document.getElementById('btn-3d').checked;
    if (!audioCtx) initAudioEngine();
    
    if (is3D) {
        if(is8D) {
            document.getElementById('btn-8d').checked = false;
            toggle8D(); 
        }
        reverbGainNode.gain.setTargetAtTime(1.5, audioCtx.currentTime, 0.1);
    } else {
        reverbGainNode.gain.setTargetAtTime(0, audioCtx.currentTime, 0.1);
    }
}

// --- SINGER PROFILE ---
function openSingerProfile(artistName) {
    const headerNameEl = document.getElementById('header-singer-name');
    const singerNameEl = document.getElementById('singer-name-profile');
    const singerPhotoEl = document.getElementById('singer-photo');
    const singerSongsList = document.getElementById('singer-songs-list');
    const songCountEl = document.getElementById('song-count');

    if(headerNameEl) headerNameEl.innerText = "Profile";
    if(singerNameEl) singerNameEl.innerText = artistName;
    
    singerPhotoEl.src = `./songs/singers/${encodeURIComponent(artistName)}.jpg`;
    singerPhotoEl.onerror = () => { 
        singerPhotoEl.src = 'https://img.icons8.com/material-rounded/128/333333/user.png'; 
    };

    const artistSongs = allSongs.filter(s => parseSongInfo(s.name).artist === artistName);
    if(songCountEl) songCountEl.innerText = artistSongs.length;

    singerSongsList.innerHTML = "";
    if (artistSongs.length === 0) {
        singerSongsList.innerHTML = "<p style='text-align:center; color:#666; font-size:12px; margin-top:20px;'>No songs found.</p>";
    } else {
        artistSongs.forEach((song) => {
            const idx = allSongs.findIndex(s => s.name === song.name);
            const meta = parseSongInfo(song.name);
            
            const div = document.createElement('div');
            div.className = 'list-item';
            div.onclick = () => { playSong(idx); switchTab('home'); minimizePlayer(); };
            div.innerHTML = `
                <div class="list-img"><span class="material-icons-round">audiotrack</span></div>
                <div class="list-info">
                    <h4>${meta.title}</h4>
                    <p>Album • RifqyMusic</p>
                </div>
                <span class="material-icons-round" style="color:#333;">play_circle</span>
            `;
            singerSongsList.appendChild(div);
        });
    }
    switchTab('profile');
}

// --- LYRICS ENGINE ---
async function loadLyrics(filename) {
    lyricsData = []; 
    const lrcName = filename.replace(/\.[^/.]+$/, "") + ".lrc";
    const url = `https://raw.githubusercontent.com/${CONFIG.user}/${CONFIG.repo}/main/${CONFIG.basePath}/lyrics/${encodeURIComponent(lrcName)}`;
    
    const btnTranslateInput = document.getElementById('btn-translate-auto');
    const menuTranslateRow = btnTranslateInput ? btnTranslateInput.closest('.fx-item') : null;

    try {
        const res = await fetch(url);
        if (res.ok) {
            const text = await res.text();
            parseLyrics(text);
            if(menuTranslateRow) menuTranslateRow.style.display = 'flex';
        } else {
            document.getElementById('lyrics-text').innerText = "...";
            if(menuTranslateRow) menuTranslateRow.style.display = 'none';
            document.getElementById('lyrics-translate').style.display = 'none';
        }
    } catch (e) { 
        console.log("No lyrics found");
        if(menuTranslateRow) menuTranslateRow.style.display = 'none';
    }
}

function parseLyrics(lrcText) {
    const lines = lrcText.split('\n');
    const regex = /^\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/;
    lyricsData = lines.map(line => {
        const match = line.match(regex);
        if (match) {
            const min = parseInt(match[1]);
            const sec = parseInt(match[2]);
            const ms = parseInt(match[3]);
            return { time: min * 60 + sec + ms / 1000, text: match[4].trim() };
        }
        return null;
    }).filter(l => l !== null);
}

// --- TRANSLATE LOGIC ---
function updateLyrics(currentTime) {
    if (lyricsData.length === 0) return;
    
    const currentLine = lyricsData.find((line, index) => {
        const nextLine = lyricsData[index + 1];
        return currentTime >= line.time && (!nextLine || currentTime < nextLine.time);
    });

    if (currentLine && currentLine.text !== lastLyricsText) {
        lastLyricsText = currentLine.text;
        document.getElementById('lyrics-text').innerText = lastLyricsText;

        if (isTranslateEnabled) {
            handleTranslation(lastLyricsText);
        }
    }
}

function toggleTranslate() {
    isTranslateEnabled = document.getElementById('btn-translate-auto').checked;
    const transEl = document.getElementById('lyrics-translate');
    
    if (isTranslateEnabled) {
        transEl.style.display = 'block';
        handleTranslation(lastLyricsText); 
    } else {
        transEl.style.display = 'none';
        transEl.innerText = "";
    }
}

async function handleTranslation(text) {
    if (!text || text === "..." || text === "" || !isTranslateEnabled) return;
    
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=id&dt=t&q=${encodeURI(text)}`;

    try {
        const response = await fetch(url);
        const data = await response.json();
        // Melanjutkan logika yang terpotong di prompt sebelumnya
        if (data && data[0] && data[0][0]) {
             document.getElementById('lyrics-translate').innerText = data[0][0][0];
        }
    } catch (e) { console.log(e) }
}

// --- [NEW] PREMIUM UI LOGIC (LIQUID GLASS & DYNAMIC) ---

function toggleLiquidUI() {
    const isEnabled = document.getElementById('btn-liquid-ui').checked;
    if (isEnabled) {
        document.body.classList.add('liquid-mode');
        // Liquid Mode butuh performa, matikan Lite Mode jika aktif
        if(isLiteMode) {
            document.getElementById('btn-litemode').checked = false;
            toggleLiteMode(); 
        }
    } else {
        document.body.classList.remove('liquid-mode');
    }
    localStorage.setItem('liquidUI', isEnabled);
}

function toggleDynamicTheme() {
    dynamicThemeEnabled = document.getElementById('btn-dynamic-theme').checked;
    if (!dynamicThemeEnabled) {
        document.documentElement.style.setProperty('--accent', '#00ff00'); // Balik Hijau
    } else {
        updateDynamicColor();
    }
    localStorage.setItem('dynamicTheme', dynamicThemeEnabled);
}

function updateDynamicColor() {
    if (!dynamicThemeEnabled) return;

    const img = document.getElementById('full-cover');
    if (!img.src || img.src.includes('icons8')) return;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const tempImg = new Image();
    
    tempImg.crossOrigin = "Anonymous"; // Penting agar tidak security error
    tempImg.src = img.src;

    tempImg.onload = function() {
        canvas.width = 1; canvas.height = 1;
        ctx.drawImage(tempImg, 0, 0, 1, 1);
        const data = ctx.getImageData(0, 0, 1, 1).data;
        
        let r = data[0], g = data[1], b = data[2];
        // Boost warna jika terlalu gelap
        if (r + g + b < 50) { r += 50; g += 50; b += 50; } 

        const color = `rgb(${r}, ${g}, ${b})`;
        document.documentElement.style.setProperty('--accent', color);
    };
}

// Init Function untuk Settingan Baru
function initPremiumThemes() {
    const savedLiquid = localStorage.getItem('liquidUI') === 'true';
    const savedDynamic = localStorage.getItem('dynamicTheme') === 'true';

    // Set Checkbox (jika elemen ada)
    const btnLiquid = document.getElementById('btn-liquid-ui');
    const btnDynamic = document.getElementById('btn-dynamic-theme');
    
    if(btnLiquid) btnLiquid.checked = savedLiquid;
    if(btnDynamic) btnDynamic.checked = savedDynamic;

    if (savedLiquid) document.body.classList.add('liquid-mode');
    dynamicThemeEnabled = savedDynamic;
}

// --- PLAYBACK LOGIC ---

function playSong(index) {
    currentIndex = index;
    const song = allSongs[index];
    const meta = parseSongInfo(song.name);

    audioPlayer.src = `https://raw.githubusercontent.com/${CONFIG.user}/${CONFIG.repo}/main/${song.folderPath}/${encodeURIComponent(song.name)}`;
    fullTitle.innerText = meta.title;
    fullArtist.innerText = meta.artist;
    
    const coverUrl = `./songs/covers/${encodeURIComponent(meta.title)}.jpg`;
    fullCover.src = coverUrl;
    fullCover.onerror = () => { fullCover.src = 'https://img.icons8.com/fluency/200/music.png'; };

    document.getElementById('mini-title').innerText = meta.title;
    document.getElementById('mini-img').src = fullCover.src;

    audioPlayer.play();
    loadLyrics(song.name);
    
    // [NEW] Trigger Dynamic Color Change
    if (dynamicThemeEnabled) {
        // Delay sedikit agar gambar termuat
        setTimeout(updateDynamicColor, 500); 
    }

    miniPlayer.style.display = 'flex';
    document.getElementById('btn-play-main').innerText = 'pause_circle';
}

function parseSongInfo(filename) {
    const cleanName = filename.replace(/\.[^/.]+$/, "");
    const parts = cleanName.split(' - ');
    return {
        artist: parts[0] ? parts[1] : 'Unknown Artist',
        title: parts[1] ? parts[0] : parts[0]
    };
}

function switchTab(tab) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(`view-${tab}`).classList.add('active');
}

// --- APP START EVENTS ---
window.addEventListener('DOMContentLoaded', () => {
    init(); // Load songs
    initPremiumThemes(); // Load Settings Liquid/Dynamic

    audioPlayer.addEventListener('timeupdate', () => {
        const p = (audioPlayer.currentTime / audioPlayer.duration) * 100;
        progressBar.value = p || 0;
        currentTimeEl.innerText = formatTime(audioPlayer.currentTime);
        durationEl.innerText = formatTime(audioPlayer.duration);
        updateLyrics(audioPlayer.currentTime);
    });

    audioPlayer.addEventListener('ended', () => {
        if (isRepeat) {
            audioPlayer.play();
        } else {
            nextSong();
        }
    });

    // Init Audio Context on first interaction
    document.body.addEventListener('click', () => {
        if (!audioCtx) initAudioEngine();
    }, { once: true });
});

function formatTime(sec) {
    if (!sec) return "0:00";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? '0' + s : s}`;
}

function nextSong() {
    let index = isShuffle ? Math.floor(Math.random() * allSongs.length) : currentIndex + 1;
    if (index >= allSongs.length) index = 0;
    playSong(index);
}

// --- UI RENDERING & LIST LOGIC (LANJUTAN) ---

function renderHomeList(songs) {
    homeList.innerHTML = '';
    songs.forEach((song) => {
        // Cari index asli di allSongs agar urutan play benar
        const index = allSongs.findIndex(s => s.name === song.name);
        const meta = parseSongInfo(song.name);
        const isSaved = savedSongs.includes(song.name);
        
        const div = document.createElement('div');
        div.className = 'list-item';
        div.innerHTML = `
            <div class="list-img" onclick="playSong(${index}); maximizePlayer()">
                <span class="material-icons-round">music_note</span>
            </div>
            <div class="list-info" onclick="playSong(${index}); maximizePlayer()">
                <h4>${meta.title}</h4>
                <p>${meta.artist}</p>
            </div>
            <div class="list-action">
                <button class="btn-icon ${isSaved ? 'active' : ''}" onclick="toggleSaved(${index}, event)">
                    <span class="material-icons-round">${isSaved ? 'favorite' : 'favorite_border'}</span>
                </button>
            </div>
        `;
        homeList.appendChild(div);
    });
}

function renderSavedList() {
    savedList.innerHTML = '';
    const saved = allSongs.filter(s => savedSongs.includes(s.name));
    
    if (saved.length === 0) {
        savedList.innerHTML = '<p style="text-align:center; padding:20px; color:#666; font-size:12px;">Belum ada lagu disimpan.</p>';
        return;
    }

    saved.forEach((song) => {
        const index = allSongs.findIndex(s => s.name === song.name);
        const meta = parseSongInfo(song.name);
        
        const div = document.createElement('div');
        div.className = 'list-item';
        div.onclick = () => { playSong(index); maximizePlayer(); };
        div.innerHTML = `
            <div class="list-img"><span class="material-icons-round">bookmark</span></div>
            <div class="list-info">
                <h4>${meta.title}</h4>
                <p>${meta.artist}</p>
            </div>
            <span class="material-icons-round" style="color:#666;">play_circle</span>
        `;
        savedList.appendChild(div);
    });
}

function toggleSaved(index, event) {
    if(event) event.stopPropagation(); // Mencegah lagu terputar saat klik love
    
    const songName = allSongs[index].name;
    const savedIdx = savedSongs.indexOf(songName);
    
    if (savedIdx > -1) {
        savedSongs.splice(savedIdx, 1);
    } else {
        savedSongs.push(songName);
    }
    
    localStorage.setItem('savedSongs', JSON.stringify(savedSongs));
    
    // Refresh tampilan tombol love tanpa reload
    renderHomeList(searchInput.value ? allSongs.filter(s => s.name.toLowerCase().includes(searchInput.value.toLowerCase())) : allSongs);
    renderSavedList();
}

// --- SEARCH & PLAYER VIEW CONTROL ---

if (searchInput) {
    searchInput.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase();
        const filtered = allSongs.filter(s => s.name.toLowerCase().includes(term));
        renderHomeList(filtered);
    });
}

function maximizePlayer() {
    if(fullPlayer) {
        fullPlayer.classList.add('active');
        // Fix untuk tampilan mobile browser address bar
        document.body.style.overflow = 'hidden'; 
    }
    if(miniPlayer) miniPlayer.style.display = 'none';
}

function minimizePlayer() {
    if(fullPlayer) {
        fullPlayer.classList.remove('active');
        document.body.style.overflow = 'auto';
    }
    if(miniPlayer) miniPlayer.style.display = 'flex';
}

// Event Listeners untuk UI Player
document.getElementById('btn-minimize')?.addEventListener('click', minimizePlayer);
miniPlayer?.addEventListener('click', maximizePlayer);

// --- END OF SCRIPT ---
