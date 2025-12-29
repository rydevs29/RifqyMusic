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
let analyzer, dataArray, canvas, canvasCtx; 
let compressorNode; // Peak Normalization

// --- [NEW] FEATURE VARIABLES ---
let pannerNode; // Untuk 8D Audio
let pannerInterval; // Timer animasi 8D
let soundscapeAudio = new Audio(); // Player khusus suara alam
let soundscapeGainNode; // Volume suara alam

// Status FX & App
let is3D = false;
let is8D = false; // [NEW] Status 8D
let isMono = false;
let isPeak = false;
let isCrossfade = false;
let isLiteMode = false; 
let isOfflineMode = localStorage.getItem('isSmartOffline') === 'true'; // [NEW] Status Cache
let currentQuality = 'Hi-Fi'; 
let isVisualizerEnabled = true; 
let playbackSpeed = 1.0;
let sleepTimer = null;

const audioPlayer = new Audio();
audioPlayer.crossOrigin = "anonymous"; 
soundscapeAudio.crossOrigin = "anonymous"; // [NEW]
soundscapeAudio.loop = true; // [NEW] Suara alam looping

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

// --- [NEW] SERVICE WORKER REGISTRATION (Smart Offline) ---
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js')
        .then(reg => console.log('Service Worker Registered (Smart Offline Ready)', reg))
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
            // [NEW] Update status toggle offline di UI jika ada
            const offlineToggle = document.getElementById('btn-smart-offline');
            if(offlineToggle) offlineToggle.checked = isOfflineMode;
        } else {
            document.getElementById('loading-text').innerText = "Library Kosong.";
        }
    } catch (e) {
        document.getElementById('loading-text').innerText = "Error: " + e.message;
    }
}

// --- SETUP AUDIO ENGINE (Updated with 8D & Soundscape) ---
function initAudioEngine() {
    if (audioCtx) return; 
    
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        audioCtx = new AudioContext();
        source = audioCtx.createMediaElementSource(audioPlayer);

        // [NEW] SOUNDSCAPE NODE (Jalur Terpisah)
        const soundscapeSource = audioCtx.createMediaElementSource(soundscapeAudio);
        soundscapeGainNode = audioCtx.createGain();
        soundscapeGainNode.gain.value = 0.5; // Default volume 50%
        soundscapeSource.connect(soundscapeGainNode);
        soundscapeGainNode.connect(audioCtx.destination); // Langsung ke output (Bypass EQ music)

        // 1. EQUALIZER
        const freqs = [60, 250, 1000, 4000, 16000];
        eqBands = freqs.map(f => {
            const filter = audioCtx.createBiquadFilter();
            filter.type = 'peaking';
            filter.frequency.value = f;
            filter.gain.value = 0; 
            return filter;
        });

        // [NEW] 2. 8D AUDIO (PANNER NODE)
        pannerNode = audioCtx.createStereoPanner(); // Node untuk geser kiri/kanan
        pannerNode.pan.value = 0;

        // 3. PEAK NORMALIZATION
        compressorNode = audioCtx.createDynamicsCompressor();
        compressorNode.threshold.setValueAtTime(-24, audioCtx.currentTime);
        compressorNode.knee.setValueAtTime(40, audioCtx.currentTime);
        compressorNode.ratio.setValueAtTime(12, audioCtx.currentTime);
        compressorNode.attack.setValueAtTime(0, audioCtx.currentTime);
        compressorNode.release.setValueAtTime(0.25, audioCtx.currentTime);

        // 4. REVERB (3D)
        reverbNode = audioCtx.createConvolver();
        reverbGainNode = audioCtx.createGain();
        reverbGainNode.gain.value = 0; 
        
        // Buat Impulse Reverb Sederhana
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

        // 6. ANALYZER
        analyzer = audioCtx.createAnalyser();
        analyzer.fftSize = 64; 
        dataArray = new Uint8Array(analyzer.frequencyBinCount);

        // --- ROUTING (UPDATED CHAIN) ---
        // Source -> EQ -> [8D Panner] -> Booster -> [Reverb/Compressor] -> Master
        
        let chain = source;
        eqBands.forEach(band => { chain.connect(band); chain = band; });
        
        // Connect to Panner (8D)
        chain.connect(pannerNode);
        
        // Connect Panner to Booster
        pannerNode.connect(boosterNode);
        
        // Reverb path (Parallel)
        boosterNode.connect(reverbNode);
        reverbNode.connect(reverbGainNode);
        reverbGainNode.connect(compressorNode);
        
        // Direct path
        boosterNode.connect(compressorNode);
        
        compressorNode.connect(masterGainNode);
        masterGainNode.connect(analyzer);
        
        connectFinalOutput();
        analyzer.connect(audioCtx.destination); 
        
        initVisualizerCanvas();
        console.log("Audio Engine Ready (With 8D & Soundscape)!");

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

// --- VISUALIZER ENGINE ---
function initVisualizerCanvas() {
    canvas = document.getElementById('visualizer');
    if(!canvas) return; 
    canvasCtx = canvas.getContext('2d');
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    drawVisualizer();
}

function drawVisualizer() {
    if (!isVisualizerEnabled) return; 

    requestAnimationFrame(drawVisualizer);
    if(!analyzer) return;

    analyzer.getByteFrequencyData(dataArray);
    canvasCtx.clearRect(0, 0, canvas.width, canvas.height);

    let barWidth = (canvas.width / dataArray.length) * 2.5;
    let barHeight;
    let x = 0;

    let computedStyle = getComputedStyle(document.body);
    let barColor = computedStyle.getPropertyValue('--accent').trim() || '#00ff00';

    canvasCtx.shadowBlur = currentQuality === 'Hi-Fi' && !isLiteMode ? 10 : 0; 
    canvasCtx.shadowColor = barColor;

    for (let i = 0; i < dataArray.length; i++) {
        barHeight = dataArray[i] / 2;
        canvasCtx.fillStyle = barColor;
        canvasCtx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
        x += barWidth + 1;
    }
}

function toggleVisualizer() {
    isVisualizerEnabled = document.getElementById('btn-visualizer').checked;
    const canvasEl = document.getElementById('visualizer');
    if (isVisualizerEnabled) {
        if(canvasEl) canvasEl.style.display = 'block';
        drawVisualizer();
    } else {
        if(canvasEl) canvasEl.style.display = 'none';
        if(canvasCtx) canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
    }
}

// --- FEATURES LOGIC ---

// [NEW] 1. SMART OFFLINE CACHE LOGIC
function toggleSmartOffline() {
    isOfflineMode = document.getElementById('btn-smart-offline').checked;
    localStorage.setItem('isSmartOffline', isOfflineMode);
    
    // Kirim pesan ke Service Worker
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({
            action: 'toggleOffline',
            status: isOfflineMode
        });
    }
    
    if(isOfflineMode) {
        alert("Smart Offline ON: Lagu yang diputar akan disimpan otomatis.");
    } else {
        // Opsional: Clear cache jika dimatikan
        if(confirm("Hapus semua lagu offline untuk hemat memori?")) {
            caches.delete('rifqymusic-songs-v1');
            alert("Cache lagu dihapus.");
        }
    }
}

// [NEW] 2. 8D AUDIO LOGIC
function toggle8D() {
    is8D = document.getElementById('btn-8d').checked;
    if (!audioCtx) initAudioEngine();
    
    if (is8D) {
        if(is3D) { 
            // Matikan 3D jika 8D nyala (biar gak tabrakan efeknya)
            document.getElementById('btn-3d').checked = false;
            reverbGainNode.gain.setTargetAtTime(0, audioCtx.currentTime, 0.1);
            is3D = false;
        }

        let time = 0;
        // Animasi Muter
        pannerInterval = setInterval(() => {
            // Rumus Sinus agar bergerak halus dari -1 (Kiri) ke 1 (Kanan)
            const x = Math.sin(time); 
            pannerNode.pan.value = x;
            time += 0.05; // Kecepatan putaran
        }, 50); // Update setiap 50ms
        
    } else {
        clearInterval(pannerInterval);
        pannerNode.pan.setTargetAtTime(0, audioCtx.currentTime, 0.5); // Balik ke tengah
    }
}

// [NEW] 3. SOUNDSCAPE OVERLAY (Focus Mode)
function toggleSoundscape(type) {
    // Type: 'rain', 'fire', 'cafe', atau 'off'
    if (!audioCtx) initAudioEngine();
    
    if (type === 'off') {
        soundscapeAudio.pause();
        return;
    }
    
    // Pastikan file soundscape ada di folder 'assets/sounds/' atau link eksternal
    // Contoh pakai link sample gratis untuk demo
    let src = '';
    if(type === 'rain') src = 'https://actions.google.com/sounds/v1/weather/rain_heavy_loud.ogg';
    if(type === 'fire') src = 'https://actions.google.com/sounds/v1/ambiences/fire.ogg';
    
    soundscapeAudio.src = src;
    soundscapeAudio.play();
}

function setSoundscapeVolume(val) {
    if(soundscapeGainNode) soundscapeGainNode.gain.value = val;
}

// --- EXISTING FEATURES ---
function toggleLiteMode() {
    isLiteMode = document.getElementById('btn-litemode').checked;
    if (isLiteMode) {
        isVisualizerEnabled = false;
        if(canvas) canvas.style.display = 'none';
        if(reverbGainNode) reverbGainNode.gain.setTargetAtTime(0, audioCtx.currentTime, 0.1);
        
        document.body.classList.add('lite-version'); 
        document.getElementById('btn-visualizer').checked = false;
        document.getElementById('btn-3d').checked = false;
        // Matikan 8D di Lite Mode
        if(is8D) {
            document.getElementById('btn-8d').checked = false;
            toggle8D();
        }
        
        alert("Lite Mode Aktif: Performa diutamakan.");
    } else {
        document.body.classList.remove('lite-version');
        alert("Lite Mode Mati: Silakan atur kembali fitur.");
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
    try {
        const res = await fetch(url);
        if (res.ok) {
            const text = await res.text();
            parseLyrics(text);
        } else {
            const lyricContainer = document.getElementById('lyrics-text');
            if(lyricContainer) lyricContainer.innerText = "...";
        }
    } catch (e) { console.log("No lyrics found"); }
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

function updateLyrics(currentTime) {
    if (lyricsData.length === 0) return;
    const currentLine = lyricsData.find((line, index) => {
        const nextLine = lyricsData[index + 1];
        return currentTime >= line.time && (!nextLine || currentTime < nextLine.time);
    });
    if (currentLine) {
        const lyricEl = document.getElementById('lyrics-text');
        if(lyricEl) lyricEl.innerText = currentLine.text;
    }
}

// --- DYNAMIC BACKGROUND & COLOR THIEVERY ---
function updateThemeColor(imgElement) {
    if (isLiteMode) return; 

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 1;
    canvas.height = 1;
    
    try {
        ctx.drawImage(imgElement, 0, 0, 1, 1);
        const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
        
        const color = `rgb(${r}, ${g}, ${b})`;
        const dimColor = `rgba(${r}, ${g}, ${b}, 0.2)`;
        
        document.documentElement.style.setProperty('--accent', color);
        document.body.style.background = `linear-gradient(to bottom, ${dimColor} 0%, #000000 100%)`;
        
        if ((r*0.299 + g*0.587 + b*0.114) > 186) {
            document.documentElement.style.setProperty('--accent', '#000000');
        }

    } catch (e) {
        console.warn("Theme extraction error (CORS):", e);
        document.documentElement.style.setProperty('--accent', '#00ff00');
        document.body.style.background = '#000000';
    }
}

// --- PLAYBACK CONTROLS ---
function setSleepTimer(minutes) {
    if (sleepTimer) clearTimeout(sleepTimer);
    if (minutes > 0) {
        sleepTimer = setTimeout(() => {
            // [NEW] Fade out volume before stop
            let fadeVol = 1.0;
            let fadeInterval = setInterval(() => {
                fadeVol -= 0.1;
                if(fadeVol <= 0) {
                    clearInterval(fadeInterval);
                    if (!audioPlayer.paused) togglePlay();
                    audioPlayer.volume = 1.0; // Reset
                } else {
                    audioPlayer.volume = fadeVol;
                }
            }, 1000); 
        }, minutes * 60000);
    }
}

function setPlaybackSpeed(speed) {
    playbackSpeed = parseFloat(speed);
    audioPlayer.playbackRate = playbackSpeed;
}

// --- CORE PLAYER LOGIC ---
function renderHomeList(songs) {
    homeList.innerHTML = "";
    songs.forEach((song, index) => {
        const isSaved = savedSongs.includes(song.name);
        const meta = parseSongInfo(song.name); 
        const isFlac = song.name.toLowerCase().endsWith('.flac');
        const fileNameNoExt = song.name.replace(/\.[^/.]+$/, "");
        const coverUrl = `./songs/covers/${encodeURIComponent(fileNameNoExt)}.jpg`;

        const div = document.createElement('div');
        div.className = 'list-item';
        div.innerHTML = `
            <div class="list-img" onclick="playSong(${index})">
                <img src="${coverUrl}" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" class="song-cover" loading="lazy">
                <div class="placeholder-box" style="display:none; width:100%; height:100%; align-items:center; justify-content:center; background:#111;">
                    <span class="material-icons-round" style="color:#333; font-size:24px;">audiotrack</span>
                </div>
                <div class="badge-flac">${isFlac ? 'FLAC' : 'HQ'}</div>
            </div>
            <div class="list-info">
                <h4 onclick="playSong(${index})">${meta.title}</h4>
                <p onclick="event.stopPropagation(); openSingerProfile('${meta.artist}')" style="cursor:pointer; color:var(--accent); display:inline-block;">${meta.artist}</p>
            </div>
            <button class="btn-save ${isSaved ? 'active' : ''}" onclick="toggleSave('${song.name}')">
                <span class="material-icons-round">${isSaved ? 'bookmark' : 'bookmark_border'}</span>
            </button>
        `;
        homeList.appendChild(div);
    });
}

function renderSavedList() {
    savedList.innerHTML = "";
    const mySavedSongs = allSongs.filter(s => savedSongs.includes(s.name));
    mySavedSongs.forEach((song) => {
        const idx = allSongs.findIndex(s => s.name === song.name);
        const meta = parseSongInfo(song.name);
        const div = document.createElement('div');
        div.className = 'list-item';
        div.innerHTML = `
            <div class="list-img" onclick="playSong(${idx})">
                <span class="material-icons-round" style="color:#666;">audiotrack</span>
            </div>
            <div class="list-info" onclick="playSong(${idx})">
                <h4>${meta.title}</h4>
                <p>${meta.artist}</p>
            </div>
            <button class="btn-save active" onclick="toggleSave('${song.name}')">
                <span class="material-icons-round">bookmark</span>
            </button>
        `;
        savedList.appendChild(div);
    });
}

function parseSongInfo(filename) {
    let cleanName = filename.replace(/\.[^/.]+$/, "").replace(/_/g, " "); 
    let parts = cleanName.split(" - ");
    if (parts.length >= 2) {
        return { artist: parts[0].trim(), title: parts[1].trim() };
    } else {
        return { artist: "RifqyMusic", title: cleanName };
    }
}

// LOGIC UTAMA: PLAY SONG (No Karaoke Folder)
function playSong(index) {
    if(!audioCtx) initAudioEngine();
    if(audioCtx && audioCtx.state === 'suspended') audioCtx.resume();

    if (isCrossfade && !audioPlayer.paused) {
        masterGainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 2); 
        setTimeout(() => startNewSong(index), 2000);
    } else {
        startNewSong(index);
    }
}

function startNewSong(index) {
    currentIndex = index;
    const song = allSongs[index];
    const meta = parseSongInfo(song.name);
    const fileNameNoExt = song.name.replace(/\.[^/.]+$/, "");
    
    // Update UI Cover & Title
    fullCover.src = `./songs/covers/${encodeURIComponent(fileNameNoExt)}.jpg`;
    
    // Trigger Dynamic Theme
    fullCover.onload = () => updateThemeColor(fullCover);
    fullCover.onerror = () => {
        fullCover.src='https://img.icons8.com/material-rounded/128/333333/musical-notes.png';
        document.documentElement.style.setProperty('--accent', '#00ff00');
        document.body.style.background = '#000000';
    };

    loadLyrics(song.name);

    if(masterGainNode) {
        masterGainNode.gain.cancelScheduledValues(audioCtx.currentTime);
        masterGainNode.gain.setValueAtTime(0.001, audioCtx.currentTime);
        masterGainNode.gain.exponentialRampToValueAtTime(1, audioCtx.currentTime + 1);
    }

    // FOLDER SELECTOR (Tanpa Karaoke)
    let folder = 'lossless';
    const isFlac = song.name.toLowerCase().endsWith('.flac');

    if (isLiteMode) {
        currentQuality = 'Data Saving'; 
        folder = 'low';
    } else {
        if (isFlac) currentQuality = 'Hi-Fi';
        else currentQuality = 'Standard';
        
        if (currentQuality === 'Standard') folder = 'med';
        if (currentQuality === 'Data Saving') folder = 'low';
    }
    
    const qualityLabel = document.getElementById('current-quality-label');
    if(qualityLabel) qualityLabel.innerText = currentQuality;

    audioPlayer.src = `./songs/${folder}/${encodeURIComponent(song.name)}`;
    audioPlayer.setAttribute('data-tried-original', 'false');
    audioPlayer.playbackRate = playbackSpeed;

    audioPlayer.onerror = function() {
        if (audioPlayer.getAttribute('data-tried-original') === 'false') {
            console.warn(`Fallback ke ${song.originalFolder}`);
            audioPlayer.setAttribute('data-tried-original', 'true');
            audioPlayer.src = `./songs/${song.originalFolder}/${encodeURIComponent(song.name)}`;
            audioPlayer.play();
        }
    };

    audioPlayer.play().catch(e => console.log("Menunggu interaksi user..."));

    fullTitle.innerText = meta.title;
    // [CODE CONTINUED FROM CUT-OFF POINT]
    if(fullArtist) {
        fullArtist.innerText = meta.artist;
        fullArtist.onclick = () => { minimizePlayer(); openSingerProfile(meta.artist); };
    }
    
    // Kirim sinyal ke SW jika Offline Mode aktif
    if (isOfflineMode && navigator.serviceWorker && navigator.serviceWorker.controller) {
        // SW otomatis akan cache karena request lewat fetch
        console.log("Caching song for offline...");
    }
}
