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
// Advanced FX Nodes
let karaokeNode; // Dummy node untuk chain
let compressorNode; // Peak Normalization

// Status FX & App
let is3D = false;
let isMono = false;
let isKaraoke = false;
let isPeak = false;
let isCrossfade = false;
let isLiteMode = false; 
let currentQuality = 'Hi-Fi'; 
let isVisualizerEnabled = true; 
let playbackSpeed = 1.0;
let sleepTimer = null;

const audioPlayer = new Audio();
audioPlayer.crossOrigin = "anonymous"; 

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
        } else {
            document.getElementById('loading-text').innerText = "Library Kosong.";
        }
    } catch (e) {
        document.getElementById('loading-text').innerText = "Error: " + e.message;
    }
}

// --- SETUP AUDIO ENGINE (FIXED) ---
function initAudioEngine() {
    if (audioCtx) return; 
    
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        audioCtx = new AudioContext();
        source = audioCtx.createMediaElementSource(audioPlayer);

        // 1. EQUALIZER
        const freqs = [60, 250, 1000, 4000, 16000];
        eqBands = freqs.map(f => {
            const filter = audioCtx.createBiquadFilter();
            filter.type = 'peaking';
            filter.frequency.value = f;
            filter.gain.value = 0; 
            return filter;
        });

        // 2. KARAOKE NODE (Pass-through)
        karaokeNode = audioCtx.createBiquadFilter();
        karaokeNode.type = "notch"; 
        karaokeNode.frequency.value = 1000; 
        karaokeNode.Q.value = 0; 

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
        const duration = 1; 
        const length = audioCtx.sampleRate * duration;
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

        // ROUTING (Chain)
        let chain = source;
        eqBands.forEach(band => { chain.connect(band); chain = band; });
        
        chain.connect(karaokeNode);
        karaokeNode.connect(boosterNode);
        karaokeNode.connect(reverbNode);
        
        reverbNode.connect(reverbGainNode);
        reverbGainNode.connect(boosterNode);
        
        boosterNode.connect(compressorNode);
        compressorNode.connect(masterGainNode);
        
        masterGainNode.connect(analyzer);
        
        // KONEKSI PENTING KE SPEAKER
        connectFinalOutput();
        analyzer.connect(audioCtx.destination); 
        
        initVisualizerCanvas();
        console.log("Audio Engine Ready & Connected!");

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

    // Warna Visualizer mengikuti tema/accent
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

function toggleLiteMode() {
    isLiteMode = document.getElementById('btn-litemode').checked;
    if (isLiteMode) {
        isVisualizerEnabled = false;
        if(canvas) canvas.style.display = 'none';
        if(reverbGainNode) reverbGainNode.gain.setTargetAtTime(0, audioCtx.currentTime, 0.1);
        
        document.body.classList.add('lite-version'); 
        
        // Reset UI Switches
        document.getElementById('btn-visualizer').checked = false;
        document.getElementById('btn-3d').checked = false;
        document.getElementById('btn-karaoke').checked = false;
        isKaraoke = false; // Matikan karaoke di lite mode
        
        alert("Lite Mode Aktif: Performa diutamakan.");
    } else {
        document.body.classList.remove('lite-version');
        alert("Lite Mode Mati: Silakan atur kembali fitur.");
    }
}

// UPDATE: KARAOKE FOLDER LOGIC (SWAP FILE)
function toggleKaraoke() {
    isKaraoke = document.getElementById('btn-karaoke').checked;
    
    // Simpan posisi saat ini
    const currentTime = audioPlayer.currentTime;
    const wasPlaying = !audioPlayer.paused;
    const song = allSongs[currentIndex];

    if (isKaraoke) {
        console.log("Karaoke Mode ON: Switching to instrumental...");
        audioPlayer.src = `./songs/karaoke/${encodeURIComponent(song.name)}`;
    } else {
        console.log("Karaoke Mode OFF: Back to original...");
        // Balik ke folder sesuai kualitas
        let folder = (currentQuality === 'Hi-Fi' ? 'lossless' : (currentQuality === 'Standard' ? 'med' : 'low'));
        audioPlayer.src = `./songs/${folder}/${encodeURIComponent(song.name)}`;
    }

    // Sinkronisasi Waktu (Seamless Transition)
    audioPlayer.onloadeddata = () => {
        audioPlayer.currentTime = currentTime;
        if (wasPlaying) audioPlayer.play();
        audioPlayer.playbackRate = playbackSpeed;
        audioPlayer.onloadeddata = null;
    };

    // Fallback Error (Jika file karaoke tidak ada)
    audioPlayer.onerror = () => {
        if(isKaraoke) {
            alert("Versi Karaoke belum tersedia untuk lagu ini.");
            document.getElementById('btn-karaoke').checked = false;
            isKaraoke = false;
            
            // Kembalikan ke original
            let folder = (currentQuality === 'Hi-Fi' ? 'lossless' : (currentQuality === 'Standard' ? 'med' : 'low'));
            audioPlayer.src = `./songs/${folder}/${encodeURIComponent(song.name)}`;
            audioPlayer.load();
            audioPlayer.currentTime = currentTime;
            if(wasPlaying) audioPlayer.play();
        }
    };
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
        
        // Logika Kontras Simple
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
            if (!audioPlayer.paused) togglePlay();
            sleepTimer = null;
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
            <div class="list-info" onclick="playSong(${index})">
                <h4>${meta.title}</h4>
                <p>${meta.artist}</p>
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

// LOGIC UTAMA: PLAY SONG & FOLDER SELECTOR
function playSong(index) {
    if(!audioCtx) initAudioEngine();
    
    // Paksa Resume jika suspended (Fix Hening)
    if(audioCtx && audioCtx.state === 'suspended') audioCtx.resume();

    // Crossfade Logic
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
    
    // Trigger Dynamic Theme saat gambar load
    fullCover.onload = () => updateThemeColor(fullCover);
    fullCover.onerror = () => {
        fullCover.src='https://img.icons8.com/material-rounded/128/333333/musical-notes.png';
        // Reset theme ke default jika error
        document.documentElement.style.setProperty('--accent', '#00ff00');
        document.body.style.background = '#000000';
    };

    loadLyrics(song.name);

    // Fade In Volume
    if(masterGainNode) {
        masterGainNode.gain.cancelScheduledValues(audioCtx.currentTime);
        masterGainNode.gain.setValueAtTime(0.001, audioCtx.currentTime);
        masterGainNode.gain.exponentialRampToValueAtTime(1, audioCtx.currentTime + 1);
    }

    // LOGIC PRIORITAS FOLDER (Karaoke > Lite > Quality)
    let folder = 'lossless';
    const isFlac = song.name.toLowerCase().endsWith('.flac');

    if (isKaraoke) {
        folder = 'karaoke';
    } else if (isLiteMode) {
        currentQuality = 'Data Saving'; 
        folder = 'low';
    } else {
        // Normal Mode
        if (isFlac) currentQuality = 'Hi-Fi';
        else currentQuality = 'Standard';
        
        if (currentQuality === 'Standard') folder = 'med';
        if (currentQuality === 'Data Saving') folder = 'low';
    }
    
    // Update Label UI
    const qualityLabel = document.getElementById('current-quality-label');
    if(qualityLabel) qualityLabel.innerText = isKaraoke ? 'Karaoke' : currentQuality;

    audioPlayer.src = `./songs/${folder}/${encodeURIComponent(song.name)}`;
    audioPlayer.setAttribute('data-tried-original', 'false');
    audioPlayer.playbackRate = playbackSpeed;

    // Error Handling Khusus Karaoke / Fallback
    audioPlayer.onerror = function() {
        if (isKaraoke) {
            console.warn("Karaoke file not found. Fallback to original.");
            alert("Versi Karaoke belum tersedia untuk lagu ini.");
            document.getElementById('btn-karaoke').checked = false;
            isKaraoke = false;
            // Recursion: play ulang dengan status karaoke mati
            startNewSong(index); 
            return;
        }

        if (audioPlayer.getAttribute('data-tried-original') === 'false') {
            console.warn(`Fallback ke ${song.originalFolder}`);
            audioPlayer.setAttribute('data-tried-original', 'true');
            audioPlayer.src = `./songs/${song.originalFolder}/${encodeURIComponent(song.name)}`;
            audioPlayer.play();
        }
    };

    audioPlayer.play().catch(e => console.log("Menunggu interaksi user..."));

    fullTitle.innerText = meta.title;
    if(fullArtist) fullArtist.innerText = meta.artist;
    document.getElementById('mini-title').innerText = meta.title;
    document.getElementById('mini-artist').innerText = meta.artist;
    miniPlayer.classList.remove('hidden');
    maximizePlayer();
    updatePlayIcon(true);
}

// --- CONTROLS ---

function updateBoost(value) {
    if(boosterNode) {
        boosterNode.gain.setTargetAtTime(value, audioCtx.currentTime, 0.1);
    }
}

function selectQuality(quality) {
    if(currentQuality === quality && !isKaraoke) return;
    
    // Jika sedang karaoke dan user ganti kualitas, matikan karaoke
    if(isKaraoke) {
        isKaraoke = false;
        document.getElementById('btn-karaoke').checked = false;
    }

    currentQuality = quality;
    const qualityLabel = document.getElementById('current-quality-label');
    if(qualityLabel) qualityLabel.innerText = currentQuality;

    const wasPlaying = !audioPlayer.paused;
    const currTime = audioPlayer.currentTime;
    
    let targetFolder = 'lossless';
    if (quality === 'Standard') targetFolder = 'med';
    if (quality === 'Data Saving') targetFolder = 'low';
    
    const song = allSongs[currentIndex];
    audioPlayer.src = `./songs/${targetFolder}/${encodeURIComponent(song.name)}`;
    audioPlayer.playbackRate = playbackSpeed; 
    
    audioPlayer.onerror = function() {
        console.warn(`File manual quality tidak ada. Fallback.`);
        audioPlayer.src = `./songs/${song.originalFolder}/${encodeURIComponent(song.name)}`;
        audioPlayer.play();
        audioPlayer.currentTime = currTime;
    };

    audioPlayer.onloadeddata = () => {
        audioPlayer.currentTime = currTime;
        if(wasPlaying) audioPlayer.play();
        audioPlayer.onloadeddata = null;
    };
    
    if(typeof closeQualitySheet === 'function') closeQualitySheet();
}

function togglePlay() {
    if(!audioCtx) initAudioEngine();
    
    // FIX HENING: Resume AudioContext
    if(audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume();
    }

    if (audioPlayer.paused) {
        if(audioPlayer.src) { audioPlayer.play(); updatePlayIcon(true); }
    } else {
        audioPlayer.pause();
        updatePlayIcon(false);
    }
}

function updatePlayIcon(isPlaying) {
    const icon = isPlaying ? "pause" : "play_arrow";
    document.getElementById('full-play-icon').innerText = icon;
    document.getElementById('mini-play-icon').innerText = icon;
}

function openSettings() {
    document.getElementById('settings-modal').classList.add('show');
    document.getElementById('settings-overlay').style.display = 'block';
    const content = document.querySelector('.settings-content');
    if(content) content.scrollTop = 0;
}

function closeSettings() {
    document.getElementById('settings-modal').classList.remove('show');
    document.getElementById('settings-overlay').style.display = 'none';
}

function updateEQ(index, value) {
    if(!audioCtx) initAudioEngine();
    if(eqBands[index]) eqBands[index].gain.value = parseFloat(value);
}

function resetEQ() {
    if(!audioCtx) return;
    eqBands.forEach(band => band.gain.value = 0);
    document.querySelectorAll('.eq-slider').forEach(slider => slider.value = 0);
    if(is3D) document.getElementById('btn-3d').click(); 
}

function toggle3D() {
    if(!audioCtx) initAudioEngine();
    is3D = !is3D;
    if(is3D) {
        reverbGainNode.gain.setTargetAtTime(0.6, audioCtx.currentTime, 0.1); 
        updateEQ(0, parseFloat(document.querySelectorAll('.eq-slider')[0].value) + 4);
        updateEQ(4, parseFloat(document.querySelectorAll('.eq-slider')[4].value) + 4);
    } else {
        reverbGainNode.gain.setTargetAtTime(0, audioCtx.currentTime, 0.1);
        updateEQ(0, parseFloat(document.querySelectorAll('.eq-slider')[0].value) - 4);
        updateEQ(4, parseFloat(document.querySelectorAll('.eq-slider')[4].value) - 4);
    }
}

function toggleMono() {
    if(!audioCtx) initAudioEngine();
    isMono = !isMono;
    connectFinalOutput();
}

// UTILS
function toggleSave(name) {
    if(savedSongs.includes(name)) savedSongs = savedSongs.filter(n => n !== name);
    else savedSongs.push(name);
    localStorage.setItem('savedSongs', JSON.stringify(savedSongs));
    renderHomeList(allSongs);
    renderSavedList();
}
function maximizePlayer() { fullPlayer.classList.add('show'); }
function minimizePlayer() { fullPlayer.classList.remove('show'); }
function switchTab(tab) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.getElementById(`view-${tab}`).classList.add('active');
    document.getElementById(`nav-${tab}`).classList.add('active');
}
function handleSearch() {
    const term = searchInput.value.toLowerCase();
    renderHomeList(allSongs.filter(s => s.name.toLowerCase().includes(term)));
}
function playNext() {
    if (isShuffle) playSong(Math.floor(Math.random() * allSongs.length));
    else currentIndex < allSongs.length - 1 ? playSong(currentIndex + 1) : playSong(0);
}
function playPrev() {
    currentIndex > 0 ? playSong(currentIndex - 1) : playSong(allSongs.length - 1);
}
function toggleShuffle() { 
    isShuffle = !isShuffle; 
    document.getElementById('shuffle-btn').style.color = isShuffle ? '#00ff00' : '#fff'; 
}
function toggleRepeat() { 
    isRepeat = !isRepeat; 
    document.getElementById('repeat-btn').style.color = isRepeat ? '#00ff00' : '#666'; 
}
audioPlayer.ontimeupdate = () => {
    if (audioPlayer.duration) {
        const pct = (audioPlayer.currentTime / audioPlayer.duration) * 100;
        progressBar.value = pct;
        document.getElementById('mini-progress').style.width = pct + '%';
        currentTimeEl.innerText = formatTime(audioPlayer.currentTime);
        durationEl.innerText = formatTime(audioPlayer.duration);
        
        updateLyrics(audioPlayer.currentTime);
    }
};
audioPlayer.onended = () => isRepeat ? audioPlayer.play() : playNext();
progressBar.oninput = () => audioPlayer.currentTime = (progressBar.value / 100) * audioPlayer.duration;
function formatTime(s) {
    let m = Math.floor(s / 60), sec = Math.floor(s % 60);
    return `${m}:${sec < 10 ? '0'+sec : sec}`;
}

init();
