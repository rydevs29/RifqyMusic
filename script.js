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

// DYNAMIC VOLUME VARIABLES
let isDynamicVol = false;
let micStream = null;
let micAnalyzer = null;

// [NEW] TRANSLATE VARIABLES
let isTranslateEnabled = false;
let lastLyricsText = "";

// Status FX & App
let is3D = false;
let is8D = false; 
let isMono = false;
let isPeak = false;
let isCrossfade = false;
let isLiteMode = false; 
let isOfflineMode = localStorage.getItem('isSmartOffline') === 'true'; 
let currentQuality = 'Hi-Fi'; 
let isVisualizerEnabled = false; 
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

// --- SETUP AUDIO ENGINE ---
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

        // 6. ANALYZER
        analyzer = audioCtx.createAnalyser();
        analyzer.fftSize = 64; 
        dataArray = new Uint8Array(analyzer.frequencyBinCount);

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
        masterGainNode.connect(analyzer);
        
        connectFinalOutput();
        analyzer.connect(audioCtx.destination); 
        
        initVisualizerCanvas();
        console.log("Audio Engine Ready!");

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
        isVisualizerEnabled = false;
        if(canvas) canvas.style.display = 'none';
        if(reverbGainNode) reverbGainNode.gain.setTargetAtTime(0, audioCtx.currentTime, 0.1);
        document.body.classList.add('lite-version'); 
        document.getElementById('btn-visualizer').checked = false;
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

// --- LYRICS ENGINE (UPDATED: AUTO-HIDE MENU TRANSLATE) ---
async function loadLyrics(filename) {
    lyricsData = []; 
    const lrcName = filename.replace(/\.[^/.]+$/, "") + ".lrc";
    const url = `https://raw.githubusercontent.com/${CONFIG.user}/${CONFIG.repo}/main/${CONFIG.basePath}/lyrics/${encodeURIComponent(lrcName)}`;
    
    // Cari elemen menu translate di dalam settings
    const btnTranslateInput = document.getElementById('btn-translate-auto');
    const menuTranslateRow = btnTranslateInput ? btnTranslateInput.closest('.fx-item') : null;

    try {
        const res = await fetch(url);
        if (res.ok) {
            const text = await res.text();
            parseLyrics(text);
            // Ada Lirik -> Tampilkan menu translate di settings
            if(menuTranslateRow) menuTranslateRow.style.display = 'flex';
        } else {
            // Gak Ada Lirik -> Sembunyikan menu & teks translate
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

        // Jika fitur translate aktif (tombol ON), panggil API
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
        handleTranslation(lastLyricsText); // Langsung translate teks saat ini
    } else {
        transEl.style.display = 'none';
        transEl.innerText = "";
    }
}

async function handleTranslation(text) {
    if (!text || text === "..." || text === "" || !isTranslateEnabled) return;
    
    // API Google Translate (Gratis & Cepat)
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=id&dt=t&q=${encodeURI(text)}`;

    try {
        const response = await fetch(url);
        const data = await response.json();
        if (data && data[0] && data[0][0]) {
            document.getElementById('lyrics-translate').innerText = data[0][0][0];
        }
    } catch (e) {
        console.error("Gagal menerjemahkan:", e);
    }
}

// --- DYNAMIC BACKGROUND ---
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

// --- CONTROLS ---
function setSleepTimer(minutes) {
    if (sleepTimer) clearTimeout(sleepTimer);
    if (minutes > 0) {
        sleepTimer = setTimeout(() => {
            let fadeVol = 1.0;
            let fadeInterval = setInterval(() => {
                fadeVol -= 0.1;
                if(fadeVol <= 0) {
                    clearInterval(fadeInterval);
                    if (!audioPlayer.paused) togglePlay();
                    audioPlayer.volume = 1.0; 
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

// --- CORE PLAYER LOGIC (FIXED) ---
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

// LOGIC UTAMA: PLAY SONG (FIXED AUTO-PLAY & MEDIA SESSION)
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
    
    // UI Update
    fullCover.src = `./songs/covers/${encodeURIComponent(fileNameNoExt)}.jpg`;
    fullCover.onload = () => updateThemeColor(fullCover);
    fullCover.onerror = () => {
        fullCover.src='https://img.icons8.com/material-rounded/128/333333/musical-notes.png';
        document.documentElement.style.setProperty('--accent', '#00ff00');
        document.body.style.background = '#000000';
    };

    loadLyrics(song.name);

    if(masterGainNode) {
        masterGainNode.gain.cancelScheduledValues(audioCtx.currentTime);
        masterGainNode.gain.setValueAtTime(1, audioCtx.currentTime); // Reset volume
    }

    // Quality Selector
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

    // FORCE PLAY (AUTO-PLAY FIX)
    const playPromise = audioPlayer.play();
    if (playPromise !== undefined) {
        playPromise.then(_ => {
            const icon = document.getElementById('full-play-icon');
            const miniIcon = document.getElementById('mini-play-icon');
            if(icon) icon.innerText = 'pause';
            if(miniIcon) miniIcon.innerText = 'pause';
            
            // --- OPTIMASI MEDIA SESSION (APK) ---
            if ('mediaSession' in navigator) {
                navigator.mediaSession.metadata = new MediaMetadata({
                    title: meta.title,
                    artist: meta.artist,
                    album: 'RifqyMusic Premium',
                    artwork: [{ src: `./songs/covers/${encodeURIComponent(fileNameNoExt)}.jpg`, sizes: '512x512', type: 'image/jpg' }]
                });
                navigator.mediaSession.setActionHandler('play', () => togglePlay());
                navigator.mediaSession.setActionHandler('pause', () => togglePlay());
                navigator.mediaSession.setActionHandler('previoustrack', () => playPrev());
                navigator.mediaSession.setActionHandler('nexttrack', () => playNext());
            }

        }).catch(error => {
            console.log("Auto-play prevented.");
        });
    }

    fullTitle.innerText = meta.title;
    if(fullArtist) {
        fullArtist.innerText = meta.artist;
        fullArtist.onclick = () => { minimizePlayer(); openSingerProfile(meta.artist); };
    }
    
    if (isOfflineMode && navigator.serviceWorker && navigator.serviceWorker.controller) {
        console.log("Caching song for offline...");
    }
    
    maximizePlayer();
    updateMiniPlayer(meta.title, meta.artist);
}

// --- CONTROLS & UTILS ---
function togglePlay() {
    if(!audioCtx) initAudioEngine();
    if(audioCtx && audioCtx.state === 'suspended') audioCtx.resume();

    const icon = document.getElementById('full-play-icon');
    const miniIcon = document.getElementById('mini-play-icon');
    
    if (audioPlayer.paused) {
        audioPlayer.play();
        if(icon) icon.innerText = 'pause';
        if(miniIcon) miniIcon.innerText = 'pause';
    } else {
        audioPlayer.pause();
        if(icon) icon.innerText = 'play_arrow';
        if(miniIcon) miniIcon.innerText = 'play_arrow';
    }
}

function playNext() {
    // FIX LOGIC PLAY NEXT
    let nextIndex;
    if (isShuffle) {
        do {
            nextIndex = Math.floor(Math.random() * allSongs.length);
        } while (nextIndex === currentIndex && allSongs.length > 1);
    } else {
        nextIndex = (currentIndex + 1) % allSongs.length;
    }
    
    setTimeout(() => {
        playSong(nextIndex);
    }, 50);
}

function playPrev() {
    let prevIndex = (currentIndex - 1 + allSongs.length) % allSongs.length;
    playSong(prevIndex);
}

function toggleShuffle() {
    isShuffle = !isShuffle;
    document.getElementById('shuffle-btn').style.color = isShuffle ? 'var(--accent)' : 'white';
}

function toggleRepeat() {
    isRepeat = !isRepeat;
    audioPlayer.loop = isRepeat; 
    document.getElementById('repeat-btn').style.color = isRepeat ? 'var(--accent)' : 'white';
}

function toggleSave(songName) {
    if (savedSongs.includes(songName)) {
        savedSongs = savedSongs.filter(s => s !== songName);
    } else {
        savedSongs.push(songName);
    }
    localStorage.setItem('savedSongs', JSON.stringify(savedSongs));
    renderHomeList(allSongs);
    renderSavedList();
}

function handleSearch() {
    const query = searchInput.value.toLowerCase();
    const filtered = allSongs.filter(s => s.name.toLowerCase().includes(query));
    renderHomeList(filtered);
}

function selectQuality(q) {
    currentQuality = q;
    const label = document.getElementById('current-quality-label');
    if(label) label.innerText = q;
    
    if (!audioPlayer.paused) {
        const currentTime = audioPlayer.currentTime;
        playSong(currentIndex); 
        audioPlayer.currentTime = currentTime; 
    }
}

// --- UI HELPERS ---
function switchTab(tab) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    
    document.getElementById(`view-${tab}`).classList.add('active');
    const navItem = document.getElementById(`nav-${tab === 'profile' ? 'home' : tab}`);
    if(navItem) navItem.classList.add('active');
}

function maximizePlayer() {
    fullPlayer.classList.add('show');
    miniPlayer.classList.add('hidden');
}

function minimizePlayer() {
    fullPlayer.classList.remove('show');
    miniPlayer.classList.remove('hidden');
}

function updateMiniPlayer(title, artist) {
    document.getElementById('mini-title').innerText = title;
    document.getElementById('mini-artist').innerText = artist;
    miniPlayer.classList.remove('hidden');
}

function openSettings() {
    document.getElementById('settings-modal').classList.add('show');
    document.getElementById('settings-overlay').style.display = 'block';
}

function closeSettings() {
    document.getElementById('settings-modal').classList.remove('show');
    document.getElementById('settings-overlay').style.display = 'none';
}

// --- EVENTS ---
audioPlayer.addEventListener('timeupdate', () => {
    const percent = (audioPlayer.currentTime / audioPlayer.duration) * 100;
    if(progressBar) progressBar.value = percent || 0;
    if(document.getElementById('mini-progress')) document.getElementById('mini-progress').style.width = percent + '%';
    
    const min = Math.floor(audioPlayer.currentTime / 60);
    const sec = Math.floor(audioPlayer.currentTime % 60);
    if(currentTimeEl) currentTimeEl.innerText = `${min}:${sec < 10 ? '0' : ''}${sec}`;
    
    updateLyrics(audioPlayer.currentTime);
});

audioPlayer.addEventListener('loadedmetadata', () => {
    const min = Math.floor(audioPlayer.duration / 60);
    const sec = Math.floor(audioPlayer.duration % 60);
    if(durationEl) durationEl.innerText = `${min}:${sec < 10 ? '0' : ''}${sec}`;
});

audioPlayer.addEventListener('ended', () => {
    if (isRepeat) {
        audioPlayer.currentTime = 0;
        audioPlayer.play();
    } else {
        playNext();
    }
});

// DETEKSI BACKGROUND APK
document.addEventListener("visibilitychange", function() {
    if (document.hidden) {
        isVisualizerEnabled = false; // Matikan gambar agar enteng di background
    } else {
        const visualizerToggle = document.getElementById('btn-visualizer');
        if (visualizerToggle && visualizerToggle.checked) {
            isVisualizerEnabled = true;
            drawVisualizer(); 
        }
    }
});

progressBar.addEventListener('input', (e) => {
    const time = (e.target.value / 100) * audioPlayer.duration;
    audioPlayer.currentTime = time;
});

// EQ & BOOST
function updateEQ(index, value) {
    if (eqBands[index]) eqBands[index].gain.value = value;
}

function resetEQ() {
    document.querySelectorAll('.eq-slider').forEach(s => s.value = 0);
    eqBands.forEach(b => b.gain.value = 0);
}

function updateBoost(val) {
    if(boosterNode) boosterNode.gain.value = val;
}

// --- START APP ---
window.addEventListener('load', init);
