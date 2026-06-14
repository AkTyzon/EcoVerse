// EcoVerse - Core Game State & Controller

const state = {
    carbonScore: 150, // 0 to 300 scale (lower is better, default clean is 150)
    greenEnergy: 0,
    naturePoints: 0,
    streakDays: 0,
    lastLogDate: "",
    lastCommuteDate: "",
    lastMealDate: "",
    lastRecycleDate: "",
    
    // Island Upgrades
    treesCount: 0,
    solarUnits: 0,
    riverClean: false,
    wildlifeActive: false,
    wildlifeCount: 0,

    // Visit Mode
    isVisitMode: false,
    visitedName: "",
    visitedAura: "low",

    // Utility Bill Configuration
    selectedBillType: "electricity",
    demoMode: true,
    isReactionActive: false,

    // Chat History
    aiChatHistory: [
        { sender: "guardian", text: "Welcome, Eco-builder! I am the Forest Guardian. I watch over the sky, rivers, and wildlife of your island. Ask me anything about sustainability or try a quick challenge to clean up the air!" }
    ],

    // Tribe Chat
    tribeChatHistory: [
        { sender: "Sarah", text: "Hey team! Just logged my morning cycle commute. Saved 3.2 kg CO₂!" },
        { sender: "David", text: "Nice! I'm planning to upload my electricity bill tonight. Hoping we hit the weekly target." },
        { sender: "Marcus", text: "Has anyone tried the Vegetarian Week challenge yet? I'm on day 3!" }
    ],

    // Firebase / Rates limit configuration
    firebaseActive: false,
    firebaseUser: null,
    firebaseToken: null,
    firebaseLimits: { count: 0, limit: 5, remaining: 5 },
    localUserUid: null,
    introPlayed: false
};

// Map carbon score to aura details
function getAuraDetails(score) {
    if (score < 40) {
        return { level: "very_low", name: "Emerald Aura", color: "#38ef7d", class: "aura-very-low" };
    } else if (score < 90) {
        return { level: "low", name: "Blue Sky Aura", color: "#00d2ff", class: "aura-low" };
    } else if (score < 150) {
        return { level: "average", name: "Light Orange Aura", color: "#ffeaa7", class: "aura-average" };
    } else if (score < 230) {
        return { level: "high", name: "Orange Smog Aura", color: "#ff9f43", class: "aura-high" };
    } else {
        return { level: "very_high", name: "Toxic Red Aura", color: "#ff4757", class: "aura-very-high" };
    }
}

// Initial Setup on DOM Load
document.addEventListener("DOMContentLoaded", () => {
    initTabs();
    initDemoController();
    initDragAndDrop();
    initFirebase();
    initAuthListeners();
    initIntroVideo();
    renderState();
    simulateWeatherEffects();
    renderTribeChat();
    updateSettingsUI();
});

// Setup keydown listeners for auth input fields (prevents default form actions)
function initAuthListeners() {
    const emailInput = document.getElementById("auth-email");
    const passInput = document.getElementById("auth-password");
    if (emailInput && passInput) {
        const handleEnterKey = (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                handleEmailAuth('signin');
            }
        };
        emailInput.addEventListener("keydown", handleEnterKey);
        passInput.addEventListener("keydown", handleEnterKey);
    }
}

// Cinematic intro video handler with seamless crossfading loop
function initIntroVideo() {
    const videos = document.querySelectorAll('.auth-video-bg');
    const overlay = document.getElementById('auth-overlay');
    if (videos.length < 2 || !overlay) return;
    
    const videoA = videos[0];
    const videoB = videos[1];
    
    // Ensure the overlay starts without intro-visible
    overlay.classList.remove('intro-visible');
    state.introPlayed = false;
    
    let started = false;
    let introTimeoutId = null;
    let safetyTimeoutId = null;
    
    const showCard = () => {
        if (started) return;
        started = true;
        
        introTimeoutId = setTimeout(() => {
            overlay.classList.add('intro-visible');
            overlay.classList.remove('intro-clickable');
            state.introPlayed = true;
            overlay.removeEventListener('click', skipIntro);
        }, 3000); // 3 seconds delay for cinematic intro
    };
    
    const skipIntro = (e) => {
        if (e.target.closest('.glass-modal') || e.target.closest('.watch-intro-link')) return;
        
        started = true;
        if (safetyTimeoutId) clearTimeout(safetyTimeoutId);
        if (introTimeoutId) clearTimeout(introTimeoutId);
        
        overlay.classList.add('intro-visible');
        overlay.classList.remove('intro-clickable');
        state.introPlayed = true;
        overlay.removeEventListener('click', skipIntro);
    };
    
    window.skipIntroHandler = skipIntro;
    overlay.addEventListener('click', skipIntro);
    overlay.classList.add('intro-clickable');
    
    videoA.addEventListener('playing', showCard);
    videoA.addEventListener('play', showCard);
    videoB.addEventListener('playing', showCard);
    videoB.addEventListener('play', showCard);
    
    // Safety fallback: if video doesn't fire events or autoplay block is hit
    safetyTimeoutId = setTimeout(() => {
        if (!started) {
            showCard();
        }
    }, 1500);

    // Setup seamless crossfade loop
    let activeVideo = videoA;
    let inactiveVideo = videoB;
    let crossfading = false;
    const fadeDuration = 1.2; // seconds (matches CSS transition)
    
    const checkTime = () => {
        if (!activeVideo.duration) return;
        
        const remaining = activeVideo.duration - activeVideo.currentTime;
        if (remaining <= fadeDuration && !crossfading) {
            crossfading = true;
            
            // Start playing inactive video in background
            inactiveVideo.currentTime = 0;
            inactiveVideo.play().then(() => {
                // Swap classes to trigger CSS opacity transitions
                activeVideo.classList.remove('video-active');
                inactiveVideo.classList.add('video-active');
                
                // Swap roles
                const temp = activeVideo;
                activeVideo = inactiveVideo;
                inactiveVideo = temp;
                
                // Wait for transition to finish before pausing the old video
                setTimeout(() => {
                    inactiveVideo.pause();
                    crossfading = false;
                }, fadeDuration * 1000);
            }).catch(err => {
                console.error("Failed to play background video buffer:", err);
                crossfading = false;
            });
        }
    };
    
    videoA.addEventListener('timeupdate', checkTime);
    videoB.addEventListener('timeupdate', checkTime);
    
    // Start playback
    videoA.play().catch(() => {
        console.log("Autoplay blocked, waiting for interaction.");
    });
}

function startWatchingAnimation(event) {
    if (event) event.preventDefault();
    const overlay = document.getElementById('auth-overlay');
    if (!overlay) return;
    
    overlay.classList.remove('intro-visible');
    overlay.classList.add('intro-clickable');
    state.introPlayed = false;
    
    triggerToast("🎬 Cinematic view active. Click anywhere to return.");
    
    if (window.skipIntroHandler) {
        overlay.removeEventListener('click', window.skipIntroHandler);
        overlay.addEventListener('click', window.skipIntroHandler);
    }
}

// Tab Navigation
function initTabs() {
    const tabButtons = document.querySelectorAll(".tab-btn");
    tabButtons.forEach(btn => {
        btn.addEventListener("click", () => {
            const targetTab = btn.getAttribute("data-tab");
            
            // Toggle active tab buttons
            document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            
            // Toggle active content
            document.querySelectorAll(".tab-content").forEach(content => {
                content.classList.remove("active");
            });
            document.getElementById(`content-${targetTab}`).classList.add("active");
            
            // Dynamic render calls
            if (targetTab === "tribes") {
                renderTribesTab();
            } else if (targetTab === "global-planet") {
                subscribeToGlobalPlanetStats();
            } else if (targetTab === "carbon-battle") {
                renderBattleTab();
            }
            
            // Scroll chat windows to bottom on reveal
            if (targetTab === "ai-companion") {
                scrollChatToBottom("ai-chat-window");
            } else if (targetTab === "tribes") {
                scrollChatToBottom("tribe-chat-messages");
            }
        });
    });
}

// Demo Controller for Judges
function initDemoController() {
    const demoBtns = document.querySelectorAll(".demo-btn");
    demoBtns.forEach(btn => {
        btn.addEventListener("click", () => {
            if (state.isVisitMode) {
                alert("Please return to your own island before toggling demo states!");
                return;
            }
            demoBtns.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            
            const targetLevel = btn.getAttribute("data-level");
            // Set carbon score boundaries
            if (targetLevel === "very_low") {
                state.carbonScore = 25;
                state.riverClean = true;
            } else if (targetLevel === "low") {
                state.carbonScore = 65;
                state.riverClean = true;
            } else if (targetLevel === "average") {
                state.carbonScore = 120;
            } else if (targetLevel === "high") {
                state.carbonScore = 180;
                state.riverClean = false;
            } else if (targetLevel === "very_high") {
                state.carbonScore = 260;
                state.riverClean = false;
            }
            renderState();
        });
    });
}

// Update UI and Isometric Island based on state
function renderState() {
    // Determine active display stats
    let activeScore = state.carbonScore;
    let activeTrees = state.treesCount;
    let activeSolar = state.solarUnits;
    let activeRiver = state.riverClean;
    let activeWildlife = state.wildlifeCount || (state.wildlifeActive ? 1 : 0);
    let aura = getAuraDetails(activeScore);
    
    if (state.isVisitMode) {
        // Friend's Island Stats
        if (state.visitedAura === "very_low") {
            activeScore = 20; activeTrees = 12; activeSolar = 3; activeRiver = true; activeWildlife = 3;
        } else if (state.visitedAura === "low") {
            activeScore = 70; activeTrees = 6; activeSolar = 2; activeRiver = true; activeWildlife = 1;
        } else if (state.visitedAura === "high") {
            activeScore = 190; activeTrees = 2; activeSolar = 0; activeRiver = false; activeWildlife = 0;
        } else if (state.visitedAura === "very_high") {
            activeScore = 270; activeTrees = 0; activeSolar = 0; activeRiver = false; activeWildlife = 0;
        }
        aura = getAuraDetails(activeScore);
    }

    // Update Headings and Stats
    document.getElementById("val-energy").innerText = state.greenEnergy;
    document.getElementById("val-points").innerText = state.naturePoints;
    document.getElementById("val-streak").innerText = `${state.streakDays} days`;
    
    // Update Aura Tag
    const auraTag = document.getElementById("aura-tag");
    const auraDot = auraTag.querySelector(".aura-dot");
    const auraText = document.getElementById("aura-text");
    auraText.innerText = aura.name;
    auraDot.style.backgroundColor = aura.color;
    auraDot.style.boxShadow = `0 0 8px ${aura.color}`;

    // Update Left side viewport backgrounds
    const viewport = document.getElementById("island-viewport");
    if (aura.level === "very_low") viewport.style.background = "var(--gradient-very-low)";
    else if (aura.level === "low") viewport.style.background = "var(--gradient-low)";
    else if (aura.level === "average") viewport.style.background = "var(--gradient-average)";
    else if (aura.level === "high") viewport.style.background = "var(--gradient-high)";
    else if (aura.level === "very_high") viewport.style.background = "var(--gradient-very-high)";

    // Update Overlay metrics
    document.getElementById("overlay-trees").innerText = `${activeTrees} Tree${activeTrees !== 1 ? 's' : ''}`;
    document.getElementById("overlay-solar").innerText = `${activeSolar} Solar Grid${activeSolar !== 1 ? 's' : ''}`;
    document.getElementById("overlay-water").innerText = activeRiver ? "Clean" : "Polluted";

    // Disable upgrading items in Visit Mode
    const upgradeButtons = document.querySelectorAll(".btn-upgrade");
    upgradeButtons.forEach(btn => {
        if (state.isVisitMode) {
            btn.disabled = true;
            btn.innerText = "Locked";
        } else {
            btn.disabled = false;
            // update cost display
            const cost = btn.parentNode.getAttribute("id") === "upg-tree" ? 30 :
                         btn.parentNode.getAttribute("id") === "upg-solar" ? 60 :
                         btn.parentNode.getAttribute("id") === "upg-river" ? 80 : 100;
            btn.innerHTML = `<span>${cost} ⚡</span>`;
        }
    });

    // Render the SVG Island
    renderEcoWorldSVG(aura.level, activeTrees, activeSolar, activeRiver, activeWildlife);
    
    // Update Guardian avatar mood, border, and status based on Carbon levels
    const guardianBox = document.getElementById("guardian-avatar-box");
    const guardianImg = document.getElementById("guardian-avatar-img");
    const guardianPulse = document.getElementById("guardian-pulse-ring");
    const guardianMood = document.getElementById("guardian-mood-badge");
    const guardianStatus = document.getElementById("guardian-status-text");

    if (guardianBox && guardianImg && guardianPulse && guardianMood && guardianStatus) {
        let moodEmoji = "😊";
        let moodText = "Happy";
        let themeColor = "var(--accent-blue)";
        let bgColor = "rgba(0, 210, 255, 0.1)";

        if (aura.level === "very_low") {
            moodEmoji = "🥳";
            moodText = "Delighted";
            themeColor = "var(--accent-emerald)";
            bgColor = "rgba(56, 239, 125, 0.1)";
            if (!state.isReactionActive) guardianImg.src = "Excited.png";
        } else if (aura.level === "low") {
            moodEmoji = "😊";
            moodText = "Pleased";
            themeColor = "var(--accent-blue)";
            bgColor = "rgba(0, 210, 255, 0.1)";
            if (!state.isReactionActive) guardianImg.src = "Happy.png";
        } else if (aura.level === "average") {
            moodEmoji = "🙂";
            moodText = "Watchful";
            themeColor = "#ffeaa7";
            bgColor = "rgba(255, 234, 167, 0.15)";
            if (!state.isReactionActive) guardianImg.src = "Thinking.png";
        } else if (aura.level === "high") {
            moodEmoji = "😷";
            moodText = "Sick & Smoggy";
            themeColor = "var(--accent-orange)";
            bgColor = "rgba(255, 159, 67, 0.15)";
            if (!state.isReactionActive) guardianImg.src = "Concerned.png";
        } else if (aura.level === "very_high") {
            moodEmoji = "😭";
            moodText = "Distressed";
            themeColor = "var(--accent-red)";
            bgColor = "rgba(255, 71, 87, 0.15)";
            if (!state.isReactionActive) guardianImg.src = "Concerned.png";
        }

        // Apply colors and styles dynamically
        guardianBox.style.borderColor = themeColor;
        guardianBox.style.background = bgColor;
        guardianPulse.style.borderColor = themeColor;
        guardianMood.style.borderColor = themeColor;
        guardianMood.innerText = moodEmoji;
        
        guardianStatus.innerHTML = `<i class="fa-solid fa-circle" style="color: ${themeColor}; font-size: 0.5rem; margin-right: 0.25rem;"></i> Guardian is ${moodText}`;
    }

    // Recalculate background animation overlays
    simulateWeatherEffects(aura.level);
}

// Generate the 3D-like Isometric Floating Eco-World SVG
function renderEcoWorldSVG(level, trees, solar, riverClean, wildlife) {
    const container = document.getElementById("svg-world-container");
    
    // Colors based on carbon levels
    let grassColorStart = "#2ecc71";
    let grassColorEnd = "#1ebd60";
    let rockColorMain = "#8c7662";
    let rockColorHighlight = "#a89079";
    let rockColorDark = "#6e5a48";
    let riverColorStart = "#00d2ff";
    let riverColorEnd = "#0084ff";
    let treeLeafColorLight = "#2ecc71";
    let treeLeafColorDark = "#27ae60";
    
    if (level === "very_low") {
        grassColorStart = "#1ebd60";
        grassColorEnd = "#10ac84";
        riverColorStart = "#00f0ff";
        riverColorEnd = "#00d2ff";
        treeLeafColorLight = "#1abc9c";
        treeLeafColorDark = "#16a085";
    } else if (level === "average") {
        grassColorStart = "#c2d48d";
        grassColorEnd = "#83915c";
        riverColorStart = "#54a0ff";
        riverColorEnd = "#2e86de";
        treeLeafColorLight = "#f39c12";
        treeLeafColorDark = "#d35400";
    } else if (level === "high") {
        grassColorStart = "#8e7c5b";
        grassColorEnd = "#6b5c43";
        rockColorMain = "#5c5043";
        rockColorHighlight = "#736556";
        rockColorDark = "#42392f";
        riverColorStart = "#8e806a";
        riverColorEnd = "#5d5447";
        treeLeafColorLight = "#e67e22";
        treeLeafColorDark = "#b33939";
    } else if (level === "very_high") {
        grassColorStart = "#6d604b";
        grassColorEnd = "#4f4535";
        rockColorMain = "#443b31";
        rockColorHighlight = "#574c3f";
        rockColorDark = "#302922";
        riverColorStart = "#574b3a";
        riverColorEnd = "#362e24";
        treeLeafColorLight = "#95a5a6";
        treeLeafColorDark = "#7f8c8d";
    }

    // Build Solar Panels positions
    const solarPositions = [
        { x: 70, y: 195 },
        { x: 90, y: 175 },
        { x: 310, y: 200 }
    ];

    // Build Trees positions
    const treePositions = [
        { x: 140, y: 200 },
        { x: 260, y: 190 },
        { x: 190, y: 180 },
        { x: 100, y: 220 },
        { x: 230, y: 210 },
        { x: 280, y: 230 },
        { x: 120, y: 240 },
        { x: 160, y: 220 },
        { x: 210, y: 230 },
        { x: 200, y: 200 }
    ];

    // Array of elements to sort by depth (y-coordinate)
    const assets = [];

    // Wind Turbine (y = 170)
    assets.push({
        y: 170,
        svg: `
            <g class="wind-turbine" transform="translate(320, 170)">
                <!-- Turbine Ground Shadow -->
                <ellipse cx="0" cy="2" rx="10" ry="3" fill="#000000" opacity="0.15" />
                
                <!-- Tapered 3D Tower -->
                <polygon points="-2.5,0 -1,-60 0,-60 0,0" fill="#cbd5e1" />
                <polygon points="0,0 0,-60 1,-60 2.5,0" fill="#f8fafc" />
                
                <!-- Nacelle (housing) -->
                <path d="M -4,-63 L 4,-63 C 6,-63 6,-57 4,-57 L -4,-57 Z" fill="#e2e8f0" stroke="#cbd5e1" stroke-width="0.5" />
                
                <!-- Rotating Blades Group -->
                <g class="blades-container" transform="translate(4, -60)">
                    <g class="blades-rotate">
                        <circle cx="0" cy="0" r="3.5" fill="#64748b" />
                        <!-- Blade 1 -->
                        <path d="M -1.5,0 L -0.5,-28 C -0.2,-31 0.2,-31 0.5,-28 L 1.5,0 Z" fill="#f8fafc" />
                        <!-- Blade 2 -->
                        <g transform="rotate(120)">
                            <path d="M -1.5,0 L -0.5,-28 C -0.2,-31 0.2,-31 0.5,-28 L 1.5,0 Z" fill="#f8fafc" />
                        </g>
                        <!-- Blade 3 -->
                        <g transform="rotate(240)">
                            <path d="M -1.5,0 L -0.5,-28 C -0.2,-31 0.2,-31 0.5,-28 L 1.5,0 Z" fill="#f8fafc" />
                        </g>
                    </g>
                </g>
            </g>
        `
    });

    // Solar Panels
    for (let i = 0; i < Math.min(solar, solarPositions.length); i++) {
        const pos = solarPositions[i];
        assets.push({
            y: pos.y,
            svg: `
                <g class="solar-panel" transform="translate(${pos.x}, ${pos.y})">
                    <!-- Solar panel stand -->
                    <line x1="15" y1="0" x2="15" y2="10" stroke="#7f8c8d" stroke-width="3" />
                    <ellipse cx="15" cy="10" rx="6" ry="2.5" fill="#34495e" />
                    <ellipse cx="15" cy="11" rx="10" ry="4" fill="#000000" opacity="0.15" />
                    
                    <!-- Panel face (tilted plane) -->
                    <g transform="translate(0, -10)">
                        <polygon points="0,0 24,-12 36,-6 12,6" fill="#2c3e50" stroke="#1a252f" stroke-width="1" />
                        <polygon points="2,0 22,-10 34,-4 14,6" fill="url(#solarGlass)" />
                        <!-- Grids -->
                        <line x1="8" y1="-3" x2="20" y2="3" stroke="#54a0ff" stroke-width="0.5" opacity="0.4" />
                        <line x1="14" y1="-6" x2="26" y2="0" stroke="#54a0ff" stroke-width="0.5" opacity="0.4" />
                        <line x1="7" y1="2.5" x2="19" y2="-3.5" stroke="#54a0ff" stroke-width="0.5" opacity="0.4" />
                        <line x1="13" y1="5.5" x2="25" y2="-0.5" stroke="#54a0ff" stroke-width="0.5" opacity="0.4" />
                        <!-- Shimmer overlay -->
                        <polygon points="2,0 22,-10 34,-4 14,6" fill="url(#solarReflection)" class="solar-shimmer" />
                    </g>
                </g>
            `
        });
    }

    // Wildlife
    if (wildlife && (level === "low" || level === "very_low")) {
        const animalPositions = [
            { x: 160, y: 240 },
            { x: 130, y: 220 },
            { x: 190, y: 230 },
            { x: 145, y: 250 },
            { x: 175, y: 215 },
            { x: 120, y: 235 },
            { x: 200, y: 255 }
        ];
        const count = typeof wildlife === 'number' ? wildlife : 1;
        for (let i = 0; i < Math.min(count, animalPositions.length); i++) {
            const pos = animalPositions[i];
            assets.push({
                y: pos.y,
                svg: `
                    <g class="animal" transform="translate(${pos.x}, ${pos.y})">
                        <!-- Shadow -->
                        <ellipse cx="0" cy="9" rx="7" ry="2.5" fill="#000000" opacity="0.15" />
                        <g class="animal-body">
                            <!-- Legs -->
                            <line x1="-4" y1="2" x2="-5" y2="9" stroke="#e67e22" stroke-width="1.5" stroke-linecap="round" />
                            <line x1="-1" y1="2" x2="-1" y2="9" stroke="#d35400" stroke-width="1.5" stroke-linecap="round" />
                            <line x1="2" y1="2" x2="1" y2="9" stroke="#e67e22" stroke-width="1.5" stroke-linecap="round" />
                            <line x1="5" y1="2" x2="5" y2="9" stroke="#d35400" stroke-width="1.5" stroke-linecap="round" />
                            
                            <!-- Body -->
                            <ellipse cx="0" cy="2" rx="7" ry="4.5" fill="#e67e22" />
                            <!-- White belly patch -->
                            <ellipse cx="0" cy="3.5" rx="5" ry="2" fill="#ffffff" opacity="0.8" />
                            
                            <!-- Neck & Head -->
                            <path d="M 4,0 L 8,-6 L 11,-5 L 7,2 Z" fill="#e67e22" />
                            <ellipse cx="10" cy="-6" rx="3.5" ry="2.5" fill="#e67e22" />
                            
                            <!-- Snout -->
                            <polygon points="11,-7 14,-5 11,-4" fill="#d35400" />
                            <circle cx="13" cy="-5" r="0.6" fill="#000000" /> <!-- Nose -->
                            
                            <!-- Ears -->
                            <polygon points="9,-8 9,-12 11,-9" fill="#d35400" />
                            
                            <!-- Spots -->
                            <circle cx="-3" cy="1" r="0.8" fill="#ffffff" opacity="0.9" />
                            <circle cx="0" cy="0" r="0.8" fill="#ffffff" opacity="0.9" />
                            <circle cx="2" cy="1.5" r="0.8" fill="#ffffff" opacity="0.9" />
                            
                            <!-- Tail -->
                            <path d="M -6,0 Q -9,-3 -7,-5" fill="none" stroke="#e67e22" stroke-width="2" stroke-linecap="round" />
                            <circle cx="-7" cy="-5" r="1" fill="#ffffff" />
                        </g>
                    </g>
                `
            });
        }
    }

    // Trees
    for (let i = 0; i < Math.min(trees, treePositions.length); i++) {
        const pos = treePositions[i];
        if (level === "high" || level === "very_high") {
            // Dry barren tree with gnarled gnarled branches
            assets.push({
                y: pos.y,
                svg: `
                    <g class="tree" transform="translate(${pos.x}, ${pos.y})">
                        <!-- Shadow -->
                        <ellipse cx="0" cy="1" rx="8" ry="3" fill="#000000" opacity="0.12" />
                        <g class="tree-sway-inner">
                            <!-- Gnarled Trunk -->
                            <path d="M 0,0 C -2,-10 2,-20 0,-30" fill="none" stroke="${rockColorMain}" stroke-width="3" stroke-linecap="round" />
                            <!-- Branches -->
                            <path d="M -1,-15 C -4,-18 -8,-15 -10,-22" fill="none" stroke="${rockColorMain}" stroke-width="2" stroke-linecap="round" />
                            <path d="M 1,-20 C 4,-22 6,-25 8,-28" fill="none" stroke="${rockColorMain}" stroke-width="1.8" stroke-linecap="round" />
                            <path d="M 0,-30 C -2,-34 -5,-35 -4,-39" fill="none" stroke="${rockColorMain}" stroke-width="1.2" stroke-linecap="round" />
                            <path d="M 0,-30 C 2,-33 5,-33 4,-38" fill="none" stroke="${rockColorMain}" stroke-width="1.2" stroke-linecap="round" />
                        </g>
                    </g>
                `
            });
        } else {
            // Lush conifer tree with low-poly light/shadow split and wind sway
            assets.push({
                y: pos.y,
                svg: `
                    <g class="tree" transform="translate(${pos.x}, ${pos.y})">
                        <!-- Shadow -->
                        <ellipse cx="0" cy="2" rx="12" ry="4" fill="#000000" opacity="0.15" />
                        <g class="tree-sway-inner">
                            <!-- Shaded Trunk -->
                            <polygon points="-2,0 -2,-20 0,-20 0,0" fill="#5c4033" />
                            <polygon points="0,0 0,-20 2,-20 2,0" fill="#795548" />
                            
                            <!-- Shaded Foliage Tier 1 (Bottom) -->
                            <polygon points="-18,-20 0,-45 0,-20" fill="${treeLeafColorLight}" />
                            <polygon points="0,-45 18,-20 0,-20" fill="${treeLeafColorDark}" />
                            
                            <!-- Shaded Foliage Tier 2 (Middle) -->
                            <polygon points="-14,-15 0,-35 0,-15" fill="${treeLeafColorLight}" />
                            <polygon points="0,-35 14,-15 0,-15" fill="${treeLeafColorDark}" />
                            
                            <!-- Shaded Foliage Tier 3 (Top) -->
                            <polygon points="-10,-10 0,-25 0,-10" fill="${treeLeafColorLight}" />
                            <polygon points="0,-25 10,-10 0,-10" fill="${treeLeafColorDark}" />
                        </g>
                    </g>
                `
            });
        }
    }

    // Sort by y-coordinate (depth-sorting)
    assets.sort((a, b) => a.y - b.y);
    const assetsSVG = assets.map(asset => asset.svg).join("\n");

    // Combine everything into final SVG
    const svgHTML = `
        <svg viewBox="0 0 400 400" xmlns="http://www.w3.org/2000/svg">
            <defs>
                <linearGradient id="grassGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stop-color="${grassColorStart}" />
                    <stop offset="100%" stop-color="${grassColorEnd}" />
                </linearGradient>
                <linearGradient id="rockGradLeft" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stop-color="${rockColorHighlight}" />
                    <stop offset="100%" stop-color="${rockColorMain}" />
                </linearGradient>
                <linearGradient id="rockGradRight" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stop-color="${rockColorMain}" />
                    <stop offset="100%" stop-color="${rockColorDark}" />
                </linearGradient>
                <linearGradient id="riverGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stop-color="${riverColorStart}" />
                    <stop offset="100%" stop-color="${riverColorEnd}" />
                </linearGradient>
                <linearGradient id="solarGlass" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stop-color="#2e86de" />
                    <stop offset="50%" stop-color="#1b1c21" />
                    <stop offset="100%" stop-color="#0a0a0c" />
                </linearGradient>
                <linearGradient id="solarReflection" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stop-color="#ffffff" stop-opacity="0.4" />
                    <stop offset="30%" stop-color="#ffffff" stop-opacity="0.0" />
                    <stop offset="100%" stop-color="#ffffff" stop-opacity="0.0" />
                </linearGradient>
            </defs>

            <style>
                .floating-island {
                    animation: floatIsland 6s ease-in-out infinite alternate;
                }
                .floating-shadow {
                    animation: floatShadow 6s ease-in-out infinite alternate;
                    transform-origin: 200px 370px;
                }
                @keyframes floatIsland {
                    0% { transform: translateY(35px); }
                    100% { transform: translateY(15px); }
                }
                @keyframes floatShadow {
                    0% {
                        transform: scale(0.85);
                        opacity: 0.35;
                    }
                    100% {
                        transform: scale(1.05);
                        opacity: 0.15;
                    }
                }
                .blades-rotate {
                    transform-origin: 0px 0px;
                    animation: rotateBlades 4s linear infinite;
                }
                @keyframes rotateBlades {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
                .tree-sway-inner {
                    transform-origin: 0px 0px;
                    animation: treeSway 4s ease-in-out infinite alternate;
                }
                @keyframes treeSway {
                    0% { transform: skewX(-1.5deg) scaleY(0.98); }
                    100% { transform: skewX(1.5deg) scaleY(1.02); }
                }
                .animal-body {
                    transform-origin: 0px 9px;
                    animation: deerGraze 6s ease-in-out infinite;
                }
                @keyframes deerGraze {
                    0%, 100% { transform: rotate(0deg); }
                    30% { transform: rotate(3deg) translateY(0.5px); }
                    35% { transform: rotate(-2deg) translateY(-0.5px); }
                    70% { transform: rotate(1deg); }
                }
                .solar-shimmer {
                    animation: solarGleam 4s infinite ease-in-out;
                }
                @keyframes solarGleam {
                    0%, 100% { opacity: 0.15; transform: translate(0px, 0px); }
                    50% { opacity: 0.7; transform: translate(2px, -1px); }
                }
                .river-flow-line-1 {
                    animation: flowMove 3s linear infinite;
                }
                .river-flow-line-2 {
                    animation: flowMove 2s linear infinite reverse;
                }
                @keyframes flowMove {
                    from { stroke-dashoffset: 40; }
                    to { stroke-dashoffset: 0; }
                }
                .waterfall-line {
                    animation: fallMove 1.2s linear infinite;
                }
                .waterfall-line-fast {
                    animation: fallMove 0.8s linear infinite;
                }
                @keyframes fallMove {
                    from { stroke-dashoffset: 20; }
                    to { stroke-dashoffset: 0; }
                }
                .splash-bubble {
                    transform-origin: center;
                    animation: bubbleUp 1.5s ease-out infinite;
                }
                .bubble-1 { animation-delay: 0.1s; }
                .bubble-2 { animation-delay: 0.5s; }
                .bubble-3 { animation-delay: 0.9s; }
                .bubble-4 { animation-delay: 1.3s; }
                @keyframes bubbleUp {
                    0% {
                        transform: translateY(0) scale(0.4);
                        opacity: 1;
                    }
                    100% {
                        transform: translateY(-6px) scale(1.4);
                        opacity: 0;
                    }
                }
                .hanging-root {
                    transform-origin: 0px 0px;
                    animation: rootSway 6s ease-in-out infinite alternate;
                }
                .root-1 { animation-delay: 0s; }
                .root-2 { animation-delay: 1.5s; }
                .root-3 { animation-delay: 3s; }
                @keyframes rootSway {
                    0% { transform: rotate(-2.5deg); }
                    100% { transform: rotate(2.5deg); }
                }
            </style>
            
            <!-- FLOATING SHADOW -->
            <ellipse cx="200" cy="370" rx="110" ry="10" fill="#000000" opacity="0.25" class="floating-shadow" />

            <!-- FLOATING WORLD GRAPHICS -->
            <g id="world-graphics" class="floating-island">
                <!-- BEDROCK LEFT FACE -->
                <polygon points="40,220 200,280 200,345 140,325 90,285 45,245" fill="url(#rockGradLeft)" />
                <!-- BEDROCK RIGHT FACE -->
                <polygon points="200,280 360,220 355,245 310,285 260,325 200,345" fill="url(#rockGradRight)" />
                
                <!-- BEDROCK LEFT SEDIMENT - SOIL LAYER -->
                <polygon points="40,220 200,280 200,292 140,280 90,260 45,235 40,225" fill="#3d3129" opacity="0.4" />
                <!-- BEDROCK RIGHT SEDIMENT - SOIL LAYER -->
                <polygon points="200,280 360,220 355,230 310,265 260,285 200,292" fill="#3d3129" opacity="0.4" />

                <!-- BEDROCK LEFT SEDIMENT - CLAY STRIPE -->
                <polygon points="40,225 45,235 90,260 140,280 200,292 200,305 140,293 90,272 45,245 40,235" fill="#5a4233" opacity="0.3" />
                <!-- BEDROCK RIGHT SEDIMENT - CLAY STRIPE -->
                <polygon points="200,292 260,285 310,265 355,230 350,240 310,277 260,297 200,305" fill="#5a4233" opacity="0.3" />

                <!-- HANGING ROOTS / VINES -->
                <g class="hanging-root root-1" transform="translate(80, 235)">
                    <path d="M 0,0 C -5,20 10,30 5,50" fill="none" stroke="${rockColorDark}" stroke-width="1.5" stroke-linecap="round" />
                </g>
                <g class="hanging-root root-2" transform="translate(150, 260)">
                    <path d="M 0,0 C 3,20 -2,35 2,50" fill="none" stroke="${level === 'very_low' || level === 'low' ? '#27ae60' : '#7f8c8d'}" stroke-width="1.2" stroke-linecap="round" />
                </g>
                <g class="hanging-root root-3" transform="translate(270, 255)">
                    <path d="M 0,0 C -5,20 5,35 0,50" fill="none" stroke="${rockColorDark}" stroke-width="1.5" stroke-linecap="round" />
                </g>

                <!-- ISLAND GRASS TOP -->
                <polygon points="200,160 360,220 200,280 40,220" fill="url(#grassGrad)" />
                <!-- GRASS BEVEL / HIGHLIGHT BORDER -->
                <polyline points="40,220 200,280 360,220" fill="none" stroke="#ffffff" stroke-width="1.5" opacity="0.25" />

                <!-- RIVERBED DEPLETION -->
                <path d="M 190,160 Q 215,200 185,240 T 192,280 L 204,280 Q 195,240 225,200 T 200,160 Z" fill="#1e272e" opacity="0.25" />

                <!-- RIVER WATER FLOW -->
                <path d="M 195,160 Q 210,200 190,240 T 198,280" fill="none" stroke="url(#riverGrad)" stroke-width="10" stroke-linecap="round" />
                <!-- Flowing current lines -->
                <path d="M 195,160 Q 210,200 190,240 T 198,280" fill="none" stroke="#ffffff" stroke-width="1.5" stroke-dasharray="8, 16" stroke-linecap="round" opacity="0.6" class="river-flow-line-1" />
                <path d="M 195,160 Q 210,200 190,240 T 198,280" fill="none" stroke="#e0f7fa" stroke-width="1" stroke-dasharray="12, 20" stroke-linecap="round" opacity="0.4" class="river-flow-line-2" />

                <!-- WATERFALL DEBOUCHING -->
                <path d="M 193,280 L 191,325 C 193,328 197,328 199,325 L 197,280 Z" fill="url(#riverGrad)" opacity="0.9" />
                <path d="M 193,280 L 191,325" stroke="#ffffff" stroke-width="1.5" stroke-dasharray="5, 10" stroke-linecap="round" class="waterfall-line" opacity="0.8" />
                <path d="M 197,280 L 199,325" stroke="#ffffff" stroke-width="1" stroke-dasharray="8, 12" stroke-linecap="round" class="waterfall-line-fast" opacity="0.7" />

                <!-- WATERFALL SPLASH -->
                <g class="waterfall-splash" transform="translate(195, 325)">
                    <ellipse cx="0" cy="0" rx="8" ry="3" fill="#ffffff" opacity="0.8" />
                    <circle cx="-4" cy="-2" r="1.8" fill="#ffffff" class="splash-bubble bubble-1" />
                    <circle cx="4" cy="-1" r="2.2" fill="#ffffff" class="splash-bubble bubble-2" />
                    <circle cx="0" cy="-4" r="2" fill="#ffffff" class="splash-bubble bubble-3" />
                    <circle cx="-2" cy="1" r="1.5" fill="#ffffff" class="splash-bubble bubble-4" />
                </g>

                <!-- RENDER UPGRADES (SORTED BY DEPTH) -->
                ${assetsSVG}
            </g>
        </svg>
    `;

    container.innerHTML = svgHTML;
}

// Generate weather overlay particles (clouds, smog, flying birds, heatwaves)
function simulateWeatherEffects(level = "very_low") {
    const container = document.getElementById("weather-effects");
    container.innerHTML = ""; // Clear old effects

    // 1. Render clouds if emissions are low/very low/average
    if (level === "very_low" || level === "low" || level === "average") {
        const cloudCount = level === "very_low" ? 3 : 2;
        for (let i = 0; i < cloudCount; i++) {
            const cloud = document.createElement("div");
            cloud.className = "cloud";
            cloud.style.width = `${randomRange(60, 120)}px`;
            cloud.style.height = `${randomRange(30, 50)}px`;
            cloud.style.top = `${randomRange(15, 45)}%`;
            cloud.style.animationDuration = `${randomRange(25, 45)}s`;
            cloud.style.animationDelay = `-${randomRange(0, 25)}s`;
            container.appendChild(cloud);
        }
    }

    // 2. Render birds if very low
    if (level === "very_low") {
        for (let i = 0; i < 4; i++) {
            const bird = document.createElement("div");
            bird.className = "bird";
            bird.style.top = `${randomRange(10, 30)}%`;
            bird.style.animationDuration = `${randomRange(12, 18)}s`;
            bird.style.animationDelay = `-${randomRange(0, 10)}s`;
            container.appendChild(bird);
        }
    }

    // 3. Render smog if high/very high
    if (level === "high" || level === "very_high") {
        const particleCount = level === "very_high" ? 12 : 6;
        for (let i = 0; i < particleCount; i++) {
            const particle = document.createElement("div");
            particle.className = "smog-particle";
            particle.style.width = `${randomRange(50, 100)}px`;
            particle.style.height = `${randomRange(30, 70)}px`;
            particle.style.top = `${randomRange(10, 80)}%`;
            particle.style.animationDuration = `${randomRange(10, 20)}s`;
            particle.style.animationDelay = `-${randomRange(0, 10)}s`;
            container.appendChild(particle);
        }
    }

    // 4. Render heatwave ripples if very high
    if (level === "very_high") {
        const ripple = document.createElement("div");
        ripple.className = "heatwave-ripple";
        container.appendChild(ripple);
    }
}

// Log Green Actions Panel
function logAction(type) {
    if (state.isVisitMode) return;

    const todayStr = new Date().toLocaleDateString('en-CA'); // "YYYY-MM-DD" local time
    if (type === "commute" && state.lastCommuteDate === todayStr) {
        triggerToast("⚠️ You have already logged a green commute today! Log again tomorrow.");
        return;
    }
    if (type === "meal" && state.lastMealDate === todayStr) {
        triggerToast("⚠️ You have already logged a green meal today! Log again tomorrow.");
        return;
    }
    if (type === "recycle" && state.lastRecycleDate === todayStr) {
        triggerToast("⚠️ You have already logged recycling today! Log again tomorrow.");
        return;
    }

    let energyReward = 0;
    let pointsReward = 0;
    let scoreReduction = 0;
    let successMessage = "";

    if (type === "commute") {
        const kmInput = document.getElementById("input-commute-km");
        const km = parseFloat(kmInput.value);
        if (isNaN(km) || km <= 0) {
            alert("Please enter a valid travel distance (km)!");
            return;
        }
        
        // Cycle/Walk saves ~0.2 kg CO2 per km compared to single-occupant car
        const co2Saved = km * 0.2;
        energyReward = Math.min(Math.round(km * 4), 60); // Max 60 energy
        pointsReward = Math.round(km * 2);
        scoreReduction = Math.round(km * 1.5);
        successMessage = `🚴 Commute Logged! You cycled/walked ${km} km, preventing ${co2Saved.toFixed(1)} kg CO₂ emissions.`;
        kmInput.value = ""; // Clear input
    } else if (type === "meal") {
        // Saving a meal reduces about 1.5 kg CO2
        energyReward = 25;
        pointsReward = 15;
        scoreReduction = 8;
        successMessage = "🥗 Meal Logged! Eating vegetarian saved approximately 1.5 kg CO₂.";
    } else if (type === "recycle") {
        energyReward = 20;
        pointsReward = 10;
        scoreReduction = 5;
        successMessage = "♻️ Sorting waste & organic composting complete! Nature index boosted.";
    }

    // Apply stats updates
    state.greenEnergy += energyReward;
    state.naturePoints += pointsReward;
    state.carbonScore = Math.max(state.carbonScore - scoreReduction, 10); // Floor of 10
    
    if (type === "commute") {
        state.lastCommuteDate = todayStr;
    } else if (type === "meal") {
        state.lastMealDate = todayStr;
    } else if (type === "recycle") {
        state.lastRecycleDate = todayStr;
    }
    
    // Day-wise streak tracking (one-time activity per day)
    const lastLog = state.lastLogDate;
    let streakUpdated = false;

    if (!lastLog) {
        state.streakDays = 1;
        state.lastLogDate = todayStr;
        streakUpdated = true;
    } else {
        const lastDate = new Date(lastLog);
        const todayDate = new Date(todayStr);
        const diffTime = Math.abs(todayDate - lastDate);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays === 1) {
            state.streakDays += 1;
            state.lastLogDate = todayStr;
            streakUpdated = true;
        } else if (diffDays > 1) {
            state.streakDays = 1;
            state.lastLogDate = todayStr;
            streakUpdated = true;
        }
    }

    // Toast notification with streak detail
    if (streakUpdated) {
        triggerToast(`${successMessage} 🔥 Daily Streak: ${state.streakDays} day${state.streakDays !== 1 ? 's' : ''}!`);
    } else {
        triggerToast(`${successMessage} (Daily streak already updated for today)`);
    }
    
    // Trigger Guardian winking reaction!
    triggerGuardianReaction("Winking.png");
    
    // Auto-complete clan actions
    updateTribeProgress(scoreReduction);

    renderState();
    saveUserData();
}

// Buy Island Upgrades
function buyUpgrade(item, cost) {
    if (state.isVisitMode) return;

    if (state.greenEnergy < cost) {
        alert("Not enough Green Energy resources! Log more real-life actions to earn energy.");
        return;
    }

    state.greenEnergy -= cost;
    let upgradeMessage = "";

    if (item === "tree") {
        state.treesCount += 1;
        state.carbonScore = Math.max(state.carbonScore - 12, 10);
        state.naturePoints += 40;
        upgradeMessage = "🌳 Conifer Tree planted on your floating island! Carbon levels reduced.";
    } else if (item === "solar") {
        state.solarUnits = Math.min(state.solarUnits + 1, 3); // Max 3
        state.carbonScore = Math.max(state.carbonScore - 20, 10);
        state.naturePoints += 75;
        upgradeMessage = "🔌 Solar Grid cell added! Clean energy source replacement active.";
    } else if (item === "river") {
        if (state.riverClean) {
            state.naturePoints += 30; // Just bonus if clean
            upgradeMessage = "💧 River bio-filters optimized. Flow volume looks excellent.";
        } else {
            state.riverClean = true;
            state.carbonScore = Math.max(state.carbonScore - 30, 10);
            state.naturePoints += 100;
            upgradeMessage = "💧 Clean bio-filters installed! The toxic sludge is gone and the river is clear.";
        }
    } else if (item === "wildlife") {
        state.wildlifeActive = true;
        state.wildlifeCount = (state.wildlifeCount || 0) + 1;
        state.naturePoints += 120;
        upgradeMessage = `🦊 Forest wildlife introduced (Count: ${state.wildlifeCount})! Deer and foxes are now returning.`;
    }

    triggerToast(upgradeMessage);
    
    // Trigger Guardian encouraging reaction!
    triggerGuardianReaction("Encouraging.png");
    
    renderState();
    saveUserData();
}

// Drag & Drop Utility Bill Simulation (Exposing API call to app.py)
function initDragAndDrop() {
    const dropZone = document.getElementById("bill-drop-zone");
    const fileInput = document.getElementById("bill-file-input");
    const loader = document.getElementById("upload-loader");
    const results = document.getElementById("bill-results");

    // Initialize global toggle checkbox
    const modeCheckbox = document.getElementById("global-mode-checkbox");
    const toggleLabel = document.getElementById("global-toggle-label");
    
    if (modeCheckbox && toggleLabel) {
        modeCheckbox.checked = !state.demoMode;
        toggleLabel.innerText = state.demoMode ? "Demo Mode" : "AI Mode";
        if (!state.demoMode) {
            toggleLabel.style.color = "var(--accent-emerald)";
        }
        
        modeCheckbox.addEventListener("change", () => {
            if (modeCheckbox.checked) {
                const isRegistered = state.firebaseActive && state.firebaseUser && !state.firebaseUser.isAnonymous;
                if (!isRegistered) {
                    modeCheckbox.checked = false;
                    openAuthModal();
                    switchAuthTab("email");
                    triggerToast("ℹ️ Please register or sign in to use AI Mode!");
                    return;
                }
            }
            state.demoMode = !modeCheckbox.checked;
            toggleLabel.innerText = state.demoMode ? "Demo Mode" : "AI Mode";
            if (!state.demoMode) {
                toggleLabel.style.color = "var(--accent-emerald)";
            } else {
                toggleLabel.style.color = "var(--text-secondary)";
            }
            updateLimitBadgesUI();
        });
    }

    // Initialize bill type segment buttons
    const segmentBtns = document.querySelectorAll(".bill-type-btn");
    segmentBtns.forEach(btn => {
        btn.addEventListener("click", () => {
            segmentBtns.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            state.selectedBillType = btn.getAttribute("data-type");
        });
    });

    dropZone.addEventListener("click", () => fileInput.click());

    dropZone.addEventListener("dragover", (e) => {
        e.preventDefault();
        dropZone.classList.add("dragover");
    });

    dropZone.addEventListener("dragleave", () => {
        dropZone.classList.remove("dragover");
    });

    dropZone.addEventListener("drop", (e) => {
        e.preventDefault();
        dropZone.classList.remove("dragover");
        if (e.dataTransfer.files.length > 0) {
            handleFileUpload(e.dataTransfer.files[0]);
        }
    });

    fileInput.addEventListener("change", () => {
        if (fileInput.files.length > 0) {
            handleFileUpload(fileInput.files[0]);
        }
    });
}

function handleFileUpload(file) {
    const isRegistered = state.firebaseActive && state.firebaseUser && !state.firebaseUser.isAnonymous;
    if (!state.demoMode && !isRegistered) {
        state.demoMode = true;
        const modeCheckbox = document.getElementById("global-mode-checkbox");
        const toggleLabel = document.getElementById("global-toggle-label");
        if (modeCheckbox && toggleLabel) {
            modeCheckbox.checked = false;
            toggleLabel.innerText = "Demo Mode";
            toggleLabel.style.color = "var(--text-secondary)";
        }
        updateLimitBadgesUI();
        openAuthModal();
        switchAuthTab("email");
        triggerToast("ℹ️ Please register or sign in to use AI Mode!");
        return;
    }

    const dropZone = document.getElementById("bill-drop-zone");
    const loader = document.getElementById("upload-loader");
    const results = document.getElementById("bill-results");

    // Hide placeholder details
    dropZone.querySelector(".upload-icon").style.display = "none";
    dropZone.querySelector("span").style.display = "none";
    loader.style.display = "flex";
    results.style.display = "none";

    // Setup Form Data
    const formData = new FormData();
    formData.append("file", file);
    formData.append("bill_type", state.selectedBillType || "electricity");
    formData.append("demo_mode", state.demoMode ? "true" : "false");

    // Setup headers
    const headers = {};
    if (state.firebaseToken) {
        headers["Authorization"] = `Bearer ${state.firebaseToken}`;
    }
    if (state.localUserUid) {
        headers["X-Local-User-Id"] = state.localUserUid;
    }
    const customKey = localStorage.getItem("custom_gemini_api_key");
    if (customKey) {
        headers["X-Gemini-API-Key"] = customKey;
    }

    // Make API request to our FastAPI backend
    fetch("/api/utility-bill", {
        method: "POST",
        headers: headers,
        body: formData
    })
    .then(res => {
        if (res.status === 401) {
            handleSignOut();
            openAuthModal();
            throw new Error("Session expired. Please sign in again.");
        }
        return res.json();
    })
    .then(data => {
        loader.style.display = "none";
        dropZone.querySelector(".upload-icon").style.display = "block";
        dropZone.querySelector("span").style.display = "block";

        if (data.success) {
            // Display results
            results.style.display = "block";
            results.innerHTML = `
                <h6>📊 AI Bill Extracted Successfully</h6>
                <ul>
                    <li><span>Meter Reading:</span> <strong>${data.metrics.units}</strong></li>
                    <li><span>Estimated Footprint:</span> <strong>${data.metrics.carbon_footprint}</strong></li>
                    <li><span>Status:</span> <strong style="color: ${data.metrics.status === 'efficient' ? 'var(--accent-emerald)' : 'var(--accent-orange)'}">${data.metrics.status.toUpperCase()}</strong></li>
                    <li><span>Regional Compare:</span> <strong>${data.metrics.comparison}</strong></li>
                </ul>
                <div class="bill-results-msg">
                    🏆 <strong>Rewards:</strong> +${data.rewards.green_energy} Green Energy, +${data.rewards.nature_points} Nature Points. <br>
                    <span>${data.message}</span>
                </div>
            `;

            // Add rewards
            state.greenEnergy += data.rewards.green_energy;
            state.naturePoints += data.rewards.nature_points;
            
            // Adjust carbon score based on efficiency
            if (data.metrics.status === 'efficient') {
                state.carbonScore = Math.max(state.carbonScore - 35, 10);
            } else {
                state.carbonScore = Math.max(state.carbonScore - 10, 10); // Reward for logging anyway!
            }
            renderState();
            saveUserData();

            if (!state.demoMode) {
                updateUserLimits();
            }
        } else {
            if (data.error && (data.error.includes("registered builders") || data.error.includes("register"))) {
                window.showConfirmDialog(
                    "🔐 AI Mode Restricted",
                    data.error + "<br><br>Would you like to register or sign in now?",
                    "Sign In",
                    () => {
                        openAuthModal();
                        switchAuthTab("email");
                    }
                );
            } else {
                window.showAlert("⚠️ Analysis Error", data.error || "Error parsing utility bill. Please check formatting.");
            }
        }
    })
    .catch(err => {
        console.error("Upload error:", err);
        loader.style.display = "none";
        dropZone.querySelector(".upload-icon").style.display = "block";
        dropZone.querySelector("span").style.display = "block";
        window.showAlert("🔌 Connection Error", "Could not connect to FastAPI bill extractor backend.");
    });
}

// AI Companion Chat Panel (Gemini SDK caller)
function sendQuickPrompt(promptText) {
    document.getElementById("ai-chat-input").value = promptText;
    sendChatMessage();
}

function sendChatMessage() {
    const isRegistered = state.firebaseActive && state.firebaseUser && !state.firebaseUser.isAnonymous;
    if (!state.demoMode && !isRegistered) {
        state.demoMode = true;
        const modeCheckbox = document.getElementById("global-mode-checkbox");
        const toggleLabel = document.getElementById("global-toggle-label");
        if (modeCheckbox && toggleLabel) {
            modeCheckbox.checked = false;
            toggleLabel.innerText = "Demo Mode";
            toggleLabel.style.color = "var(--text-secondary)";
        }
        updateLimitBadgesUI();
        openAuthModal();
        switchAuthTab("email");
        triggerToast("ℹ️ Please register or sign in to use AI Mode!");
        return;
    }

    const input = document.getElementById("ai-chat-input");
    const message = input.value.trim();
    if (!message) return;

    input.value = ""; // Clear input

    const chatWindow = document.getElementById("ai-chat-window");

    // 1. Append User Message
    const userMsg = document.createElement("div");
    userMsg.className = "msg self";
    userMsg.innerHTML = `
        <div class="msg-sender">You</div>
        <div class="msg-text">${escapeHTML(message)}</div>
    `;
    chatWindow.appendChild(userMsg);
    scrollChatToBottom("ai-chat-window");

    // 2. Append Guardian typing indicators
    const guardianMsg = document.createElement("div");
    guardianMsg.className = "msg guardian";
    guardianMsg.innerHTML = `
        <div class="msg-sender"><i class="fa-solid fa-owl"></i> Forest Guardian</div>
        <div class="msg-text"><div class="spinner" style="display:inline-block; margin-right: 0.5rem;"></div>Thinking...</div>
    `;
    chatWindow.appendChild(guardianMsg);
    scrollChatToBottom("ai-chat-window");

    // 3. Make API request to our FastAPI backend chat agent
    const auraDetails = getAuraDetails(state.carbonScore);
    const headers = {
        "Content-Type": "application/json"
    };
    if (state.firebaseToken) {
        headers["Authorization"] = `Bearer ${state.firebaseToken}`;
    }
    if (state.localUserUid) {
        headers["X-Local-User-Id"] = state.localUserUid;
    }
    const customKey = localStorage.getItem("custom_gemini_api_key");
    if (customKey) {
        headers["X-Gemini-API-Key"] = customKey;
    }

    fetch("/api/ai-chat", {
        method: "POST",
        headers: headers,
        body: JSON.stringify({
            message: message,
            carbon_level: auraDetails.level,
            green_energy: state.greenEnergy,
            nature_points: state.naturePoints,
            demo_mode: state.demoMode
        })
    })
    .then(res => {
        if (res.status === 401) {
            handleSignOut();
            openAuthModal();
            throw new Error("Session expired. Please sign in again.");
        }
        return res.json();
    })
    .then(data => {
        // Format markdown response gently
        const formattedReply = formatMarkdown(data.reply);
        guardianMsg.querySelector(".msg-text").innerHTML = formattedReply;
        scrollChatToBottom("ai-chat-window");

        if (!state.demoMode) {
            updateUserLimits();
        }

        if (data.reply && (data.reply.includes("registered builders") || data.reply.includes("register"))) {
            setTimeout(() => {
                if (confirm("AI Mode is only available for registered builders. Would you like to register or sign in now?")) {
                    openAuthModal();
                    switchAuthTab("email");
                }
            }, 1000);
        }
    })
    .catch(err => {
        console.error("AI chat communication error:", err);
        guardianMsg.querySelector(".msg-text").innerText = "Sorry, I lost connection to the EcoVerse core server. Keep logging green actions!";
        scrollChatToBottom("ai-chat-window");
    });
}

// Tribe Interaction (Visit Friends, Tribe Chat)
function renderTribeChat() {
    const chatBox = document.getElementById("tribe-chat-messages");
    chatBox.innerHTML = "";
    
    state.tribeChatHistory.forEach(msg => {
        const item = document.createElement("div");
        item.className = `msg ${msg.sender === 'Guest' ? 'self' : 'tribe-msg'}`;
        item.innerHTML = `
            <div class="msg-sender">${msg.sender}</div>
            <div class="msg-text">${escapeHTML(msg.text)}</div>
        `;
        chatBox.appendChild(item);
    });
    scrollChatToBottom("tribe-chat-messages");
}

function sendTribeMessage() {
    const isRegistered = state.firebaseActive && state.firebaseUser && !state.firebaseUser.isAnonymous;
    if (isRegistered) {
        if (window.sendRealTribeMessage) {
            window.sendRealTribeMessage();
        }
        return;
    }

    const input = document.getElementById("tribe-chat-input");
    const msgText = input.value.trim();
    if (!msgText) return;

    input.value = "";
    
    // Add user message
    state.tribeChatHistory.push({ sender: "Guest", text: msgText });
    renderTribeChat();

    // Trigger simulated companion response from tribe mates after 1 second
    setTimeout(() => {
        const replies = [
            "Nice one! That adds to our community goal.",
            "That's awesome, let's keep the streak going!",
            "Agreed! I'm doing my daily vegetarian meal right now.",
            "Solar power grids make a huge difference, highly recommend upgrading!"
        ];
        const names = ["Sarah", "David", "Marcus"];
        const randomName = names[Math.floor(Math.random() * names.length)];
        const randomReply = replies[Math.floor(Math.random() * replies.length)];

        state.tribeChatHistory.push({ sender: randomName, text: randomReply });
        renderTribeChat();
    }, 1200);
}

// Visit Tribe Members Islands
function visitFriend(name, aura) {
    state.isVisitMode = true;
    state.visitedName = name;
    state.visitedAura = aura;

    // Show banner
    const banner = document.getElementById("visit-banner");
    document.getElementById("visited-friend-name").innerText = name;
    banner.style.display = "flex";

    // Switch tab to EcoCity to see their world
    document.getElementById("tab-eco-city").click();

    // Render friend's island
    renderState();
    
    triggerToast(`🛸 Visited ${name}'s EcoCity. Check out their sky aura and forest cover!`);
}

function returnToOwnIsland() {
    state.isVisitMode = false;
    document.getElementById("visit-banner").style.display = "none";
    renderState();
    triggerToast("🛸 Returned to your own EcoCity.");
}

// Update weekly tribe goal progress dynamically
function updateTribeProgress(reduction) {
    const pctLabel = document.getElementById("tribe-goal-pct");
    const fillBar = document.getElementById("tribe-goal-bar");
    
    let currentPct = parseFloat(pctLabel.innerText);
    if (isNaN(currentPct)) currentPct = 72; // default fallback
    
    const addedPct = parseFloat((reduction / 50).toFixed(1));
    const newPct = Math.min(currentPct + addedPct, 100);
    
    pctLabel.innerText = `${newPct}% Completed`;
    fillBar.style.width = `${newPct}%`;
}

// Helpers for quantity selection and UI updating
function updateContributeButtonText() {
    const qtyInput = document.getElementById("event-tree-qty");
    let qty = 1;
    if (qtyInput) {
        qty = parseInt(qtyInput.value);
        if (isNaN(qty) || qty < 1) {
            qty = 1;
        }
    }
    const totalPoints = qty * 10;
    const btn = document.getElementById("btn-event-contribute");
    if (btn) {
        btn.innerHTML = `<i class="fa-solid fa-hand-holding-seedling"></i> Contribute ${totalPoints} Nature Points to plant ${qty.toLocaleString()} ${qty === 1 ? 'tree' : 'trees'}`;
    }
}

function setEventTreeQty(qty) {
    const qtyInput = document.getElementById("event-tree-qty");
    if (qtyInput) {
        qtyInput.value = qty;
        updateContributeButtonText();
    }
}

function updateLocalGlobalUI(qty) {
    const healthVal = document.getElementById("global-health-val");
    if (healthVal) {
        let health = parseFloat(healthVal.innerText);
        if (isNaN(health)) health = 83.4;
        const newHealth = parseFloat((health + qty * 0.05).toFixed(2));
        healthVal.innerText = `${newHealth}%`;
    }

    const progText = document.getElementById("event-progress-text");
    const progPct = document.getElementById("event-progress-pct");
    const progBar = document.getElementById("event-progress-bar");
    if (progText) {
        const match = progText.innerText.match(/Progress:\s+([\d,]+)/);
        if (match) {
            const cur = parseInt(match[1].replace(/,/g, '')) + qty;
            const target = 1000000;
            const newPct = Math.min(100, parseFloat(((cur / target) * 100).toFixed(1)));
            progText.innerText = `Progress: ${cur.toLocaleString()} / ${target.toLocaleString()} Trees`;
            if (progPct) progPct.innerText = `${newPct}%`;
            if (progBar) progBar.style.width = `${newPct}%`;
        }
    }
}

// Global Planet Restoration Page
function contributeToEvent() {
    if (state.isVisitMode) return;
    
    const qtyInput = document.getElementById("event-tree-qty");
    let qty = 1;
    if (qtyInput) {
        qty = parseInt(qtyInput.value);
        if (isNaN(qty) || qty < 1) {
            qty = 1;
            qtyInput.value = 1;
            updateContributeButtonText();
        }
    }

    const totalPoints = qty * 10;
    if (state.naturePoints < totalPoints) {
        window.showAlert("Not Enough Points", `You need at least ${totalPoints} Nature Points to contribute ${qty} ${qty === 1 ? 'tree' : 'trees'}. Complete tasks or upgrade your island first!`);
        return;
    }

    state.naturePoints -= totalPoints;
    renderState();

    const isRegistered = state.firebaseActive && state.firebaseUser && !state.firebaseUser.isAnonymous;
    if (isRegistered) {
        // Save user state
        saveUserData();
        
        // Write increment to global stats document via backend
        fetch("/api/multiplayer/global-stats/contribute", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${state.firebaseToken}`
            },
            body: JSON.stringify({ count: qty })
        })
        .then(res => res.json())
        .then(resData => {
            if (resData.success) {
                triggerToast(`🌍 Contributed ${qty} ${qty === 1 ? 'tree' : 'trees'} to Earth Restoration Event live!`);
                updateLocalGlobalUI(qty);
            } else {
                console.error("Error updating global stats:", resData.error);
                triggerToast("⚠️ Failed to update global stats.");
            }
        })
        .catch(err => {
            console.error("Error updating global stats:", err);
            triggerToast("⚠️ Failed to update global stats.");
        });
    } else {
        // Local/Guest mode increments
        updateLocalGlobalUI(qty);
        triggerToast("🌍 Contributed Nature Points! The global forest cover is expanding.");
        saveUserData();
    }
}

// Carbon Battle Duel logic
function runCarbonBattle() {
    const outcomeDiv = document.getElementById("battle-outcome");
    const btn = document.getElementById("btn-run-battle");
    
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner-third spin"></i> Running battle duel simulations...`;

    const isRegistered = state.firebaseActive && state.firebaseUser && !state.firebaseUser.isAnonymous;
    if (isRegistered && state.selectedBattleOpponent) {
        const opponent = state.selectedBattleOpponent;
        
        setTimeout(() => {
            btn.disabled = false;
            btn.innerHTML = `<i class="fa-solid fa-swords"></i> Execute Carbon Battle!`;
            outcomeDiv.style.display = "block";

            // Calculate power scores
            const myPower = (150 - state.carbonScore) + (state.treesCount * 10) + (state.solarUnits * 15) + (state.riverClean ? 30 : 0);
            const oppPower = (150 - (opponent.carbonScore || 150)) + ((opponent.treesCount || 0) * 10) + ((opponent.solarUnits || 0) * 15) + (opponent.riverClean ? 30 : 0);

            let result = "draw";
            if (myPower > oppPower) {
                result = "win";
            } else if (myPower < oppPower) {
                result = "loss";
            }

            const myName = state.firebaseUser.displayName || (state.firebaseUser.email ? state.firebaseUser.email.split('@')[0] : "Registered User");
            const oppName = opponent.displayName;

            if (result === "win") {
                state.naturePoints += 80;
                state.greenEnergy += 20;
                outcomeDiv.innerHTML = `
                    <h5 style="color: var(--accent-emerald)"><i class="fa-solid fa-trophy"></i> Victory! ${escapeHTML(myName)} Wins!</h5>
                    <p>Your sustainability upgrades (power rating: ${myPower}) outperformed ${escapeHTML(oppName)} (power rating: ${oppPower}). You successfully claimed the Ecosystem Boost.</p>
                    <div style="margin-top: 0.4rem; font-size: 0.7rem; color: var(--text-secondary)">
                        🏆 <strong>Rewards:</strong> +80 Nature Points, +20 Green Energy boost.
                    </div>
                `;
                triggerToast("⚔️ Carbon Battle won! Nature Points rewarded.");
            } else if (result === "loss") {
                state.naturePoints += 30; // Consolation
                outcomeDiv.innerHTML = `
                    <h5 style="color: var(--accent-orange)"><i class="fa-solid fa-circle-xmark"></i> Defeat! ${escapeHTML(oppName)} Wins!</h5>
                    <p>${escapeHTML(oppName)}'s green upgrades (power rating: ${oppPower}) out-performed yours (power rating: ${myPower}). Keep upgrading your island to win future duels!</p>
                    <div style="margin-top: 0.4rem; font-size: 0.7rem; color: var(--text-secondary)">
                        🏆 <strong>Rewards:</strong> +30 Nature Points (Consolation).
                    </div>
                `;
                triggerToast("⚔️ Carbon Battle completed. Opponent won.");
            } else {
                state.naturePoints += 50;
                state.greenEnergy += 10;
                outcomeDiv.innerHTML = `
                    <h5 style="color: var(--text-secondary)"><i class="fa-solid fa-handshake"></i> Close Match! Draw!</h5>
                    <p>Both you and ${escapeHTML(oppName)} have identical carbon power ratings (${myPower}). It's a tie!</p>
                    <div style="margin-top: 0.4rem; font-size: 0.7rem; color: var(--text-secondary)">
                        🏆 <strong>Rewards:</strong> +50 Nature Points, +10 Green Energy.
                    </div>
                `;
                triggerToast("⚔️ Carbon Battle completed in a draw.");
            }

            renderState();
            saveUserData();
        }, 1500);
        return;
    }
    
    // Guest/Local mode default simulation
    setTimeout(() => {
        btn.disabled = false;
        btn.innerHTML = `<i class="fa-solid fa-swords"></i> Execute Carbon Battle!`;
        outcomeDiv.style.display = "block";
        
        let win = false;
        if (state.carbonScore < 150) {
            win = true;
        }

        if (win) {
            state.naturePoints += 80;
            state.greenEnergy += 20;
            outcomeDiv.innerHTML = `
                <h5 style="color: var(--accent-emerald)"><i class="fa-solid fa-trophy"></i> Victory! Guest (You) Wins!</h5>
                <p>Your transport, energy, and diet carbon savings outperformed Sarah. You have successfully claimed the Ecosystem Boost.</p>
                <div style="margin-top: 0.4rem; font-size: 0.7rem; color: var(--text-secondary)">
                    🏆 <strong>Rewards:</strong> +80 Nature Points, +20 Green Energy boost.
                </div>
            `;
            triggerToast("⚔️ Carbon Battle won! Nature Points rewarded.");
        } else {
            state.naturePoints += 30;
            outcomeDiv.innerHTML = `
                <h5 style="color: var(--accent-orange)"><i class="fa-solid fa-handshake"></i> Close Match! Draw!</h5>
                <p>Sarah's low-emissions public transport offset your energy efficiency. Both players contributed to global restoration.</p>
                <div style="margin-top: 0.4rem; font-size: 0.7rem; color: var(--text-secondary)">
                    🏆 <strong>Rewards:</strong> +30 Nature Points (Consolation).
                </div>
            `;
            triggerToast("⚔️ Carbon Battle completed in a draw.");
        }
        renderState();
        saveUserData();
    }, 1500);
}

// Utility functions
function randomRange(min, max) {
    return Math.random() * (max - min) + min;
}

function triggerToast(message) {
    const toast = document.createElement("div");
    toast.style.position = "fixed";
    toast.style.bottom = "2rem";
    toast.style.right = "2rem";
    toast.style.background = "rgba(18, 26, 43, 0.9)";
    toast.style.border = "1px solid var(--accent-emerald)";
    toast.style.color = "white";
    toast.style.padding = "0.75rem 1.25rem";
    toast.style.borderRadius = "var(--radius-md)";
    toast.style.boxShadow = "0 10px 20px rgba(0,0,0,0.4)";
    toast.style.fontSize = "0.75rem";
    toast.style.zIndex = "999";
    toast.style.pointerEvents = "none";
    toast.style.animation = "slideUp 0.3s ease";
    toast.innerHTML = `<i class="fa-solid fa-bell" style="color: var(--accent-emerald); margin-right: 0.5rem"></i> ${message}`;
    
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.style.transition = "opacity 0.5s ease";
        toast.style.opacity = "0";
        setTimeout(() => toast.remove(), 500);
    }, 3000);
}

function scrollChatToBottom(id) {
    const win = document.getElementById(id);
    if (win) {
        win.scrollTop = win.scrollHeight;
    }
}

function escapeHTML(str) {
    return str.replace(/[&<>'"]/g, 
        tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
    );
}

function formatMarkdown(text) {
    // Basic formatting helpers for emojis and bolding
    let formatted = text
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/\n\n/g, '<br><br>')
        .replace(/\n/g, '<br>');
    
    return formatted;
}

// Function to temporarily trigger a special expression (e.g. winking or encouraging)
function triggerGuardianReaction(expression, durationMs = 2500) {
    const guardianImg = document.getElementById("guardian-avatar-img");
    if (!guardianImg) return;
    
    // Set temp source and state flag
    guardianImg.src = expression;
    state.isReactionActive = true;
    
    // Reset back to normal mood state after duration
    if (window.guardianReactionTimeout) {
        clearTimeout(window.guardianReactionTimeout);
    }
    
    window.guardianReactionTimeout = setTimeout(() => {
        state.isReactionActive = false;
        // Re-run state rendering to restore the correct image
        renderState();
    }, durationMs);
}

// --- Firebase Authentication & Client State Limits ---

function initFirebase() {
    // 1. Check/generate local user UUID
    let localUid = localStorage.getItem("ecoverse_local_uid");
    if (!localUid) {
        localUid = 'user_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
        localStorage.setItem("ecoverse_local_uid", localUid);
    }
    state.localUserUid = localUid;

    // 2. Fetch Firebase config from backend
    fetch("/api/firebase-config")
        .then(res => res.json())
        .then(data => {
            if (data.firebase_enabled && data.config && data.config.apiKey) {
                state.firebaseActive = true;
                // Initialize Firebase Compat SDK
                firebase.initializeApp(data.config);
                
                 // Listen to auth changes
                 firebase.auth().onAuthStateChanged(user => {
                     // Clean up any active listeners
                     if (state.tribeChatUnsubscribe) {
                         state.tribeChatUnsubscribe();
                         state.tribeChatUnsubscribe = null;
                     }
                     if (state.globalPlanetUnsubscribe) {
                         state.globalPlanetUnsubscribe();
                         state.globalPlanetUnsubscribe = null;
                     }
                     if (user) {
                          state.firebaseUser = user;
                          closeAuthModal();
                          // Fetch user token
                          user.getIdToken().then(token => {
                              state.firebaseToken = token;
                              enforceDemoModeForGuests();
                              updateUserLimits();
                              loadUserData();
                              renderTribesTab();
                              renderBattleTab();
                              subscribeToGlobalPlanetStats();
                          });
                      } else {
                          state.firebaseUser = null;
                          state.firebaseToken = null;
                          state.firebaseLimits = { count: 0, limit: 5, remaining: 5 };
                          enforceDemoModeForGuests();
                          openAuthModal();
                          updateProfileWidgetUI();
                          updateLimitBadgesUI();
                          loadUserData();
                          renderTribesTab();
                          renderBattleTab();
                          subscribeToGlobalPlanetStats();
                      };
                 });
            } else {
                console.log("Firebase is operating in offline Local Mode (in-memory limits).");
                state.firebaseActive = false;
                updateUserLimits();
                openAuthModal();
                updateProfileWidgetUI();
            }
        })
        .catch(err => {
            console.error("Error retrieving Firebase configuration:", err);
            state.firebaseActive = false;
            updateUserLimits();
            openAuthModal();
            updateProfileWidgetUI();
        });
}

function enforceDemoModeForGuests() {
    const isRegistered = state.firebaseActive && state.firebaseUser && !state.firebaseUser.isAnonymous;
    if (!isRegistered) {
        state.demoMode = true;
        const modeCheckbox = document.getElementById("global-mode-checkbox");
        const toggleLabel = document.getElementById("global-toggle-label");
        if (modeCheckbox && toggleLabel) {
            modeCheckbox.checked = false;
            toggleLabel.innerText = "Demo Mode";
            toggleLabel.style.color = "var(--text-secondary)";
        }
        updateLimitBadgesUI();
    }
}

function updateUserLimits() {
    const headers = {};
    if (state.firebaseToken) {
        headers["Authorization"] = `Bearer ${state.firebaseToken}`;
    }
    if (state.localUserUid) {
        headers["X-Local-User-Id"] = state.localUserUid;
    }

    fetch("/api/user-limits", { headers })
        .then(res => res.json())
        .then(data => {
            state.firebaseLimits = {
                count: data.count,
                limit: data.limit,
                remaining: data.remaining
            };
            enforceDemoModeForGuests();
            updateProfileWidgetUI();
            updateLimitBadgesUI();
        })
        .catch(err => {
            console.error("Error updating user limits:", err);
            enforceDemoModeForGuests();
        });
}

function updateProfileWidgetUI() {
    const connectBtn = document.getElementById("btn-connect-profile");
    const detailsPill = document.getElementById("profile-details-pill");
    const nameText = document.getElementById("profile-name-mini");
    const limitsText = document.getElementById("profile-limits-mini");

    if (!connectBtn || !detailsPill) return;

    if (state.firebaseUser) {
        connectBtn.style.display = "none";
        detailsPill.style.display = "flex";
        
        let displayName = state.firebaseUser.email || "Guest User";
        if (state.firebaseUser.isAnonymous) {
            displayName = "Guest Builder";
        } else {
            const idx = displayName.indexOf("@");
            if (idx > 0) displayName = displayName.substring(0, idx);
        }
        
        nameText.innerText = displayName;
        limitsText.innerText = `AI: ${state.firebaseLimits.remaining}/${state.firebaseLimits.limit}`;
    } else if (!state.firebaseActive) {
        connectBtn.style.display = "none";
        detailsPill.style.display = "flex";
        nameText.innerText = "Local Session";
        limitsText.innerText = `AI: ${state.firebaseLimits.remaining}/${state.firebaseLimits.limit}`;
    } else {
        connectBtn.style.display = "flex";
        detailsPill.style.display = "none";
    }
}

function updateLimitBadgesUI() {
    const badgeIds = ["ai-limit-badge", "chat-limit-badge", "bill-limit-badge"];
    
    badgeIds.forEach(id => {
        const element = document.getElementById(id);
        if (!element) return;

        if (state.demoMode) {
            element.className = "tab-limit-badge";
            if (id === "ai-limit-badge") {
                element.style.display = "none";
            } else {
                element.innerText = "AI: Unlimited (Demo)";
                element.style.color = "var(--text-secondary)";
            }
        } else {
            element.style.display = "inline-block";
            
            const remaining = state.firebaseLimits.remaining;
            const total = state.firebaseLimits.limit;
            element.innerText = `AI: ${remaining}/${total} remaining`;
            
            if (remaining === 0) {
                element.className = "tab-limit-badge exhausted";
            } else {
                element.className = "tab-limit-badge limited";
            }
        }
    });
}

function openAuthModal() {
    const overlay = document.getElementById("auth-overlay");
    if (overlay) {
        overlay.style.display = "flex";
        const errorText = document.getElementById("auth-error-msg");
        if (errorText) errorText.style.display = "none";
        
        // Clear input credentials fields
        const emailInput = document.getElementById("auth-email");
        const passInput = document.getElementById("auth-password");
        if (emailInput) emailInput.value = "";
        if (passInput) passInput.value = "";
        
        // Reset eye icon and password masking
        const passToggleIcon = document.getElementById("password-toggle-icon");
        if (passInput && passToggleIcon) {
            passInput.type = "password";
            passToggleIcon.className = "fa-solid fa-eye";
        }
        
        // Combat delayed browser autofills when modal is shown
        setTimeout(() => {
            if (!state.firebaseUser && overlay.style.display === "flex") {
                const emailLate = document.getElementById("auth-email");
                const passLate = document.getElementById("auth-password");
                if (emailLate) emailLate.value = "";
                if (passLate) passLate.value = "";
            }
        }, 300);
        
        // If the intro has already played, show the card immediately
        if (state.introPlayed) {
            overlay.classList.add("intro-visible");
        }
    }
}

function closeAuthModal() {
    const overlay = document.getElementById("auth-overlay");
    if (overlay) overlay.style.display = "none";
}

function togglePasswordVisibility() {
    const passInput = document.getElementById("auth-password");
    const toggleIcon = document.getElementById("password-toggle-icon");
    if (!passInput || !toggleIcon) return;

    if (passInput.type === "password") {
        passInput.type = "text";
        toggleIcon.className = "fa-solid fa-eye-slash";
    } else {
        passInput.type = "password";
        toggleIcon.className = "fa-solid fa-eye";
    }
}

function switchAuthTab(tabName) {
    const tabGuest = document.getElementById("tab-guest-login");
    const tabEmail = document.getElementById("tab-email-login");
    const contentGuest = document.getElementById("auth-content-guest");
    const contentEmail = document.getElementById("auth-content-email");

    if (tabName === "guest") {
        tabGuest.classList.add("active");
        tabEmail.classList.remove("active");
        contentGuest.style.display = "block";
        contentEmail.style.display = "none";
    } else {
        tabGuest.classList.remove("active");
        tabEmail.classList.add("active");
        contentGuest.style.display = "none";
        contentEmail.style.display = "block";
    }
    const errMsg = document.getElementById("auth-error-msg");
    if (errMsg) errMsg.style.display = "none";
}

function loginAnonymously() {
    if (!state.firebaseActive) {
        triggerToast("🚀 Guest Profile connected (Local fallback)!");
        closeAuthModal();
        loadUserData();
        return;
    }
    
    firebase.auth().signInAnonymously()
        .then(() => {
            triggerToast("🚀 Guest Profile connected!");
            closeAuthModal();
        })
        .catch(err => {
            console.warn("Anonymous signin failed, falling back to local guest mode:", err);
            // Fallback to local guest mode
            state.firebaseUser = {
                isAnonymous: true,
                uid: "guest_" + state.localUserUid,
                email: null,
                displayName: "Guest Builder"
            };
            state.firebaseToken = "mock_guest_token";
            enforceDemoModeForGuests();
            triggerToast("🚀 Connected as Guest (Local Fallback Mode)!");
            closeAuthModal();
            loadUserData();
            renderTribesTab();
            renderBattleTab();
            subscribeToGlobalPlanetStats();
            updateProfileWidgetUI();
            updateLimitBadgesUI();
        });
}

function handleEmailAuth(mode) {
    const emailInput = document.getElementById("auth-email");
    const passInput = document.getElementById("auth-password");
    const errorText = document.getElementById("auth-error-msg");

    if (!emailInput || !passInput) return;

    const email = emailInput.value.trim();
    const password = passInput.value.trim();

    if (!email || !password) {
        errorText.innerText = "Please fill in all fields.";
        errorText.style.display = "block";
        return;
    }

    if (!state.firebaseActive) {
        errorText.innerText = "Firebase is operating in offline Local Mode. Email profiles cannot be created.";
        errorText.style.display = "block";
        return;
    }

    errorText.style.display = "none";

    if (mode === "signup") {
        firebase.auth().createUserWithEmailAndPassword(email, password)
            .then(() => {
                triggerToast("🎉 Account created successfully!");
                closeAuthModal();
            })
            .catch(err => {
                errorText.innerText = err.message;
                errorText.style.display = "block";
            });
    } else {
        firebase.auth().signInWithEmailAndPassword(email, password)
            .then(() => {
                triggerToast("🔑 Signed in successfully!");
                closeAuthModal();
            })
            .catch(err => {
                errorText.innerText = err.message;
                errorText.style.display = "block";
            });
    }
}

function loginWithGoogle() {
    if (!state.firebaseActive) {
        const errorText = document.getElementById("auth-error-msg");
        if (errorText) {
            errorText.innerText = "Firebase is operating in offline Local Mode. Google sign-in cannot be used.";
            errorText.style.display = "block";
            switchAuthTab("email");
        }
        return;
    }

    const provider = new firebase.auth.GoogleAuthProvider();
    firebase.auth().signInWithPopup(provider)
        .then((result) => {
            triggerToast(`👋 Welcome, ${result.user.displayName || 'Eco-builder'}!`);
            closeAuthModal();
        })
        .catch(err => {
            console.error("Google signin error:", err);
            const errorText = document.getElementById("auth-error-msg");
            if (errorText) {
                errorText.innerText = err.message;
                errorText.style.display = "block";
                switchAuthTab("email");
            } else {
                alert("Google sign-in failed: " + err.message);
            }
        });
}

function handleSignOut() {
    if (state.tribeChatUnsubscribe) {
        state.tribeChatUnsubscribe();
        state.tribeChatUnsubscribe = null;
    }
    if (state.globalPlanetUnsubscribe) {
        state.globalPlanetUnsubscribe();
        state.globalPlanetUnsubscribe = null;
    }
    if (state.firebaseActive) {
        firebase.auth().signOut()
            .then(() => {
                triggerToast("👋 Disconnected profile.");
                state.firebaseUser = null;
                state.firebaseToken = null;
                updateUserLimits();
                renderTribesTab();
                renderBattleTab();
                subscribeToGlobalPlanetStats();
            })
            .catch(err => console.error("Signout error:", err));
    } else {
        triggerToast("Cleared local session.");
        localStorage.removeItem("ecoverse_local_state_" + state.localUserUid);
        loadUserData();
        openAuthModal();
        renderTribesTab();
        renderBattleTab();
        subscribeToGlobalPlanetStats();
    }
}

// --- Dynamic Load/Save Custom Game States ---

function saveUserData() {
    // Guest sessions are temporary and should not persist progress (no Firestore/localStorage saves)
    if (!state.firebaseActive || (state.firebaseUser && state.firebaseUser.isAnonymous)) {
        console.log("Guest session: progress saving is disabled. Sign in or register to persist your island upgrades!");
        return;
    }

    const stats = {
        carbonScore: state.carbonScore,
        greenEnergy: state.greenEnergy,
        naturePoints: state.naturePoints,
        streakDays: state.streakDays,
        lastLogDate: state.lastLogDate,
        lastCommuteDate: state.lastCommuteDate,
        lastMealDate: state.lastMealDate,
        lastRecycleDate: state.lastRecycleDate,
        treesCount: state.treesCount,
        solarUnits: state.solarUnits,
        riverClean: state.riverClean,
        wildlifeActive: state.wildlifeActive,
        wildlifeCount: state.wildlifeCount || 0
    };

    if (state.firebaseActive && state.firebaseUser) {
        const uid = state.firebaseUser.uid;
        
        // Save to localStorage as a cache/offline fallback
        localStorage.setItem("ecoverse_local_state_" + uid, JSON.stringify(stats));
        
        firebase.firestore().collection("users").doc(uid).collection("game_state").doc("data")
            .set(stats)
            .then(() => {
                console.log("State successfully saved to Firestore.");
                // Sync public profile via backend API
                const displayName = state.firebaseUser.displayName || (state.firebaseUser.email ? state.firebaseUser.email.split('@')[0] : "Registered User");
                fetch("/api/multiplayer/profile", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${state.firebaseToken}`
                    },
                    body: JSON.stringify({
                        displayName: displayName,
                        email: state.firebaseUser.email || "",
                        carbonScore: state.carbonScore,
                        greenEnergy: state.greenEnergy,
                        naturePoints: state.naturePoints,
                        treesCount: state.treesCount,
                        solarUnits: state.solarUnits,
                        riverClean: state.riverClean,
                        wildlifeActive: state.wildlifeActive,
                        wildlifeCount: state.wildlifeCount || 0
                    })
                })
                .then(res => res.json())
                .then(resData => {
                    if (!resData.success) console.error("Profile sync error:", resData.error);
                })
                .catch(err => console.error("Error saving public user profile:", err));
            })
            .catch(err => {
                console.error("Firestore save error (using localStorage cache):", err);
                if (err.code === "permission-denied") {
                    triggerToast("⚠️ Firestore save denied! Enable read/write in Firebase Rules.");
                }
            });
    } else if (state.localUserUid) {
        localStorage.setItem("ecoverse_local_state_" + state.localUserUid, JSON.stringify(stats));
        console.log("State successfully saved to local storage.");
    }
}

// Map carbon score to default stats
function loadUserData() {
    const defaultStats = {
        carbonScore: 150,
        greenEnergy: 0,
        naturePoints: 0,
        streakDays: 0,
        treesCount: 0,
        solarUnits: 0,
        riverClean: false,
        wildlifeActive: false,
        wildlifeCount: 0
    };

    // Guest sessions always start with a clean slate
    if (!state.firebaseActive || (state.firebaseUser && state.firebaseUser.isAnonymous)) {
        applyLoadedStats(defaultStats);
        return;
    }

    if (state.firebaseActive && state.firebaseUser) {
        const uid = state.firebaseUser.uid;
        firebase.firestore().collection("users").doc(uid).collection("game_state").doc("data").get()
            .then(doc => {
                if (doc.exists) {
                    const saved = doc.data();
                    applyLoadedStats(saved);
                } else {
                    // Check if local cache has it
                    const localData = localStorage.getItem("ecoverse_local_state_" + uid);
                    if (localData) {
                        try {
                            const saved = JSON.parse(localData);
                            applyLoadedStats(saved);
                            return;
                        } catch (e) {
                            console.error("Error parsing local state:", e);
                        }
                    }
                    applyLoadedStats(defaultStats);
                    saveUserData();
                }
            })
            .catch(err => {
                console.error("Firestore load error, falling back to localStorage cache:", err);
                if (err.code === "permission-denied") {
                    triggerToast("⚠️ Firestore load denied! Enable read/write in Firebase Rules.");
                }
                const localData = localStorage.getItem("ecoverse_local_state_" + uid);
                if (localData) {
                    try {
                        const saved = JSON.parse(localData);
                        applyLoadedStats(saved);
                        return;
                    } catch (e) {
                        console.error("Error parsing local state cache:", e);
                    }
                }
                applyLoadedStats(defaultStats);
            });
    } else if (state.localUserUid) {
        const localData = localStorage.getItem("ecoverse_local_state_" + state.localUserUid);
        if (localData) {
            try {
                const saved = JSON.parse(localData);
                applyLoadedStats(saved);
            } catch (e) {
                console.error("Error parsing local state:", e);
                applyLoadedStats(defaultStats);
            }
        } else {
            applyLoadedStats(defaultStats);
            saveUserData();
        }
    } else {
        applyLoadedStats(defaultStats);
    }
}

function applyLoadedStats(stats) {
    state.carbonScore = stats.carbonScore !== undefined ? stats.carbonScore : 150;
    state.greenEnergy = stats.greenEnergy !== undefined ? stats.greenEnergy : 0;
    state.naturePoints = stats.naturePoints !== undefined ? stats.naturePoints : 0;
    state.streakDays = stats.streakDays !== undefined ? stats.streakDays : 0;
    state.lastLogDate = stats.lastLogDate !== undefined ? stats.lastLogDate : "";
    state.lastCommuteDate = stats.lastCommuteDate !== undefined ? stats.lastCommuteDate : "";
    state.lastMealDate = stats.lastMealDate !== undefined ? stats.lastMealDate : "";
    state.lastRecycleDate = stats.lastRecycleDate !== undefined ? stats.lastRecycleDate : "";
    state.treesCount = stats.treesCount !== undefined ? stats.treesCount : 0;
    state.solarUnits = stats.solarUnits !== undefined ? stats.solarUnits : 0;
    state.riverClean = stats.riverClean !== undefined ? stats.riverClean : false;
    state.wildlifeActive = stats.wildlifeActive !== undefined ? stats.wildlifeActive : false;
    state.wildlifeCount = stats.wildlifeCount !== undefined ? stats.wildlifeCount : 0;
    
    renderState();
}

// ==========================================
// CENTRALIZED MULTIPLAYER OPERATIONS (FIRESTORE)
// ==========================================

function renderTribesTab() {
    const container = document.getElementById("tribes-tab-container");
    if (!container) return;

    const isRegistered = state.firebaseActive && state.firebaseUser && !state.firebaseUser.isAnonymous;
    if (!isRegistered) {
        container.innerHTML = `
            <div class="tribes-layout">
                <div class="glass-card tribe-status-card">
                    <div class="tribe-meta">
                        <div class="tribe-badge"><i class="fa-solid fa-solar-panel"></i></div>
                        <div>
                            <h4>Solar Squad</h4>
                            <p>Rank #14 Globally &bull; 18 Active Members</p>
                        </div>
                    </div>

                    <div class="tribe-goal-box">
                        <div class="goal-label-row">
                            <span>Weekly Goal: Reduce 1,000 kg CO₂</span>
                            <strong id="tribe-goal-pct">72% Completed</strong>
                        </div>
                        <div class="progress-track">
                            <div class="progress-fill" id="tribe-goal-bar" style="width: 72%;"></div>
                        </div>
                        <span class="goal-timer"><i class="fa-regular fa-clock"></i> 2 days, 9 hours remaining</span>
                    </div>

                    <div class="tribe-members-list">
                        <h5>Tribe Members & Contributions</h5>
                        <div class="member-item">
                            <span class="member-name"><i class="fa-solid fa-user-crown"></i> Guest (You)</span>
                            <div class="member-stats">
                                <span class="aura-indicator aura-very-low" title="Emerald Aura"></span>
                                <span>32 kg saved</span>
                            </div>
                        </div>
                        <div class="member-item clickable-member" onclick="visitFriend('Sarah', 'high')">
                            <span class="member-name"><i class="fa-solid fa-user"></i> Sarah <small class="visit-hint">Visit Island</small></span>
                            <div class="member-stats">
                                <span class="aura-indicator aura-high" title="Orange Smog Aura"></span>
                                <span>18 kg saved</span>
                            </div>
                        </div>
                        <div class="member-item clickable-member" onclick="visitFriend('David', 'low')">
                            <span class="member-name"><i class="fa-solid fa-user"></i> David <small class="visit-hint">Visit Island</small></span>
                            <div class="member-stats">
                                <span class="aura-indicator aura-low" title="Blue Sky Aura"></span>
                                <span>24 kg saved</span>
                            </div>
                        </div>
                        <div class="member-item clickable-member" onclick="visitFriend('Marcus', 'very_high')">
                            <span class="member-name"><i class="fa-solid fa-user"></i> Marcus <small class="visit-hint">Visit Island</small></span>
                            <div class="member-stats">
                                <span class="aura-indicator aura-very-high" title="Toxic Red Aura"></span>
                                <span>0 kg saved</span>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="glass-card tribe-chat-card">
                    <h4><i class="fa-solid fa-comments"></i> Tribe Chat</h4>
                    <div class="chat-messages" id="tribe-chat-messages"></div>
                    <div class="chat-input-area">
                        <input type="text" id="tribe-chat-input" placeholder="Type a message to your tribe...">
                        <button class="btn-chat-send" onclick="sendTribeMessage()"><i class="fa-solid fa-paper-plane"></i></button>
                    </div>
                </div>
            </div>
        `;
        renderTribeChat();
        return;
    }

    // Call dynamic backend API
    fetch("/api/multiplayer/tribe", {
        headers: { "Authorization": `Bearer ${state.firebaseToken}` }
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            if (data.hasTribe) {
                renderActiveTribeUI(container, data.tribe, data.members);
            } else {
                renderJoinCreateTribeUI(container, data.publicTribes);
            }
        } else {
            container.innerHTML = `<div class="glass-card"><p>Error: ${data.error}</p></div>`;
        }
    })
    .catch(err => {
        console.error("Error fetching tribe details:", err);
        container.innerHTML = `<div class="glass-card"><p>Error connecting to EcoVerse servers: ${err.message}</p></div>`;
    });
}

function renderJoinCreateTribeUI(container, publicTribes) {
    container.innerHTML = `
        <div style="display: flex; justify-content: center; align-items: center; padding: 2rem;">
            <i class="fa-solid fa-spinner-third spin" style="font-size: 2rem; color: var(--accent-emerald);"></i>
            <span style="margin-left: 1rem; color: var(--text-secondary);">Loading registered users...</span>
        </div>
    `;

    // Fetch registered users via backend API
    fetch("/api/multiplayer/users", {
        headers: { "Authorization": `Bearer ${state.firebaseToken}` }
    })
    .then(res => res.json())
    .then(data => {
        if (!data.success) {
            container.innerHTML = `<div class="glass-card"><p>Error fetching users: ${data.error}</p></div>`;
            return;
        }

        const otherUsers = data.users || [];
        let usersChecklistHTML = "";
        if (otherUsers.length === 0) {
            usersChecklistHTML = `<p style="font-size: 0.8rem; color: var(--text-muted); font-style: italic; margin-top: 0.5rem;">No other registered users found in EcoVerse yet. Invite friends to register!</p>`;
        } else {
            usersChecklistHTML = `
                <div style="max-height: 150px; overflow-y: auto; margin-top: 0.5rem; display: flex; flex-direction: column; gap: 0.4rem; padding-right: 0.5rem;">
                    ${otherUsers.map(u => {
                        const aura = getAuraDetails(u.carbonScore || 150);
                        return `
                            <label style="display: flex; align-items: center; justify-content: space-between; background: rgba(255,255,255,0.02); border: 1px solid var(--border-glass); padding: 0.4rem 0.6rem; border-radius: 6px; cursor: pointer; font-size: 0.8rem;">
                                <div style="display: flex; align-items: center; gap: 0.5rem;">
                                    <input type="checkbox" name="tribe-invite-user" value="${u.uid}" style="cursor: pointer;">
                                    <span>${escapeHTML(u.displayName)}</span>
                                </div>
                                <div style="display: flex; align-items: center; gap: 0.3rem;">
                                    <span class="aura-indicator" style="background-color: ${aura.color}; width: 8px; height: 8px; border-radius: 50%; display: inline-block;"></span>
                                    <span style="font-size: 0.7rem; color: var(--text-muted);">${aura.name}</span>
                                </div>
                            </label>
                        `;
                    }).join("")}
                </div>
            `;
        }

        let tribesListHTML = "";
        const activeTribes = publicTribes || [];
        if (activeTribes.length === 0) {
            tribesListHTML = `<p style="font-size: 0.8rem; color: var(--text-muted); font-style: italic; margin-top: 0.5rem;">No tribes created yet. Be the first to start a movement!</p>`;
        } else {
            tribesListHTML = `
                <div style="max-height: 320px; overflow-y: auto; margin-top: 0.5rem; display: flex; flex-direction: column; gap: 0.6rem; padding-right: 0.5rem;">
                    ${activeTribes.map(t => {
                        return `
                            <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.02); border: 1px solid var(--border-glass); padding: 0.6rem 0.8rem; border-radius: 8px;">
                                <div>
                                    <strong style="color: #fff; font-size: 0.85rem;">${escapeHTML(t.name)}</strong>
                                    <div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 0.15rem;">
                                        👥 ${t.membersCount} Member${t.membersCount !== 1 ? 's' : ''} &bull; Goal: ${t.weeklyGoal || 1000} kg CO₂
                                    </div>
                                </div>
                                <button class="btn-upgrade" style="padding: 0.3rem 0.8rem; font-size: 0.75rem;" onclick="joinTribe('${t.id}')">Join</button>
                            </div>
                        `;
                    }).join("")}
                </div>
            `;
        }

        container.innerHTML = `
            <div class="tribes-layout">
                <div class="glass-card" style="flex: 1; min-width: 280px;">
                    <h4><i class="fa-solid fa-users-medical"></i> Create a New Tribe</h4>
                    <p style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: 1rem;">Start a sustainability movement! Choose a name and invite other registered builders to form a real tribe.</p>
                    
                    <div class="input-group" style="margin-bottom: 1rem;">
                        <label style="font-size: 0.75rem; font-weight: 600; text-transform: uppercase; color: var(--text-muted); margin-bottom: 0.35rem; display: block;">Tribe Name</label>
                        <input type="text" id="new-tribe-name" placeholder="e.g. Eco Warriors" style="width: 100%; padding: 0.5rem 0.75rem; background: rgba(0,0,0,0.3); border: 1px solid var(--border-glass); border-radius: 6px; color: #fff; font-size: 0.85rem;">
                    </div>

                    <div class="input-group">
                        <label style="font-size: 0.75rem; font-weight: 600; text-transform: uppercase; color: var(--text-muted); margin-bottom: 0.35rem; display: block;">Invite Members</label>
                        ${usersChecklistHTML}
                    </div>

                    <button class="btn-primary btn-full-width" style="margin-top: 1.5rem;" onclick="createTribe()">
                        <i class="fa-solid fa-users-rays"></i> Create & Launch Tribe
                    </button>
                </div>

                <div class="glass-card" style="flex: 1; min-width: 280px;">
                    <h4><i class="fa-solid fa-compass"></i> Join an Existing Tribe</h4>
                    <p style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: 1rem;">Browse public tribes in EcoVerse and join forces to achieve weekly carbon savings together.</p>
                    
                    ${tribesListHTML}
                </div>
            </div>
        `;
    })
    .catch(err => {
        console.error("Error loading users:", err);
        container.innerHTML = `<div class="glass-card"><p>Error connecting to EcoVerse: ${err.message}</p></div>`;
    });
}

window.createTribe = function() {
    const tribeName = document.getElementById("new-tribe-name").value.trim();
    if (!tribeName) {
        alert("Please enter a tribe name.");
        return;
    }
    const checkedBoxes = document.querySelectorAll('input[name="tribe-invite-user"]:checked');
    const invitedUids = Array.from(checkedBoxes).map(cb => cb.value);

    fetch("/api/multiplayer/tribe/create", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${state.firebaseToken}`
        },
        body: JSON.stringify({ name: tribeName, invitedUids: invitedUids })
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            triggerToast("🎉 Eco Tribe successfully created!");
            renderTribesTab();
        } else {
            alert("Unable to create tribe: " + data.error);
        }
    })
    .catch(err => alert("Server error: " + err.message));
};

window.joinTribe = function(tribeId) {
    fetch("/api/multiplayer/tribe/join", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${state.firebaseToken}`
        },
        body: JSON.stringify({ tribeId: tribeId })
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            triggerToast("🎉 Successfully joined the tribe!");
            renderTribesTab();
        } else {
            alert("Unable to join tribe: " + data.error);
        }
    })
    .catch(err => alert("Server error: " + err.message));
};

function renderActiveTribeUI(container, tribe, members) {
    let totalSaved = 0;
    members.forEach(m => {
        const savings = Math.max(0, 150 - (m.carbonScore || 150));
        totalSaved += savings;
    });

    const weeklyGoal = tribe.weeklyGoal || 1000;
    const progressPct = Math.min(100, Math.floor((totalSaved / weeklyGoal) * 100));

    const currentUid = state.firebaseUser.uid;
    const membersListHTML = members.map(m => {
        const isSelf = m.uid === currentUid;
        const aura = getAuraDetails(m.carbonScore || 150);
        const savings = Math.max(0, 150 - (m.carbonScore || 150));
        
        return `
            <div class="member-item ${isSelf ? '' : 'clickable-member'}" ${isSelf ? '' : `onclick="visitRealUser('${m.uid}', '${escapeHTML(m.displayName)}')"`}>
                <span class="member-name">
                    <i class="fa-solid ${m.uid === tribe.creatorUid ? 'fa-user-crown' : 'fa-user'}"></i>
                    ${escapeHTML(m.displayName)} ${isSelf ? '(You)' : '<small class="visit-hint">Visit Island</small>'}
                </span>
                <div class="member-stats">
                    <span class="aura-indicator" style="background-color: ${aura.color};" title="${aura.name}"></span>
                    <span>${savings} kg saved</span>
                </div>
            </div>
        `;
    }).join("");

    container.innerHTML = `
        <div class="tribes-layout">
            <div class="glass-card tribe-status-card">
                <div class="tribe-meta">
                    <div class="tribe-badge"><i class="fa-solid fa-users-rays"></i></div>
                    <div>
                        <h4>${escapeHTML(tribe.name)}</h4>
                        <p>Active Tribe &bull; ${tribe.members.length} Member${tribe.members.length !== 1 ? 's' : ''}</p>
                    </div>
                </div>

                <div class="tribe-goal-box">
                    <div class="goal-label-row">
                        <span>Weekly Goal: Reduce ${weeklyGoal} kg CO₂</span>
                        <strong id="tribe-goal-pct">${progressPct}% Completed</strong>
                    </div>
                    <div class="progress-track">
                        <div class="progress-fill" id="tribe-goal-bar" style="width: ${progressPct}%;"></div>
                    </div>
                    <span class="goal-timer"><i class="fa-solid fa-earth-americas"></i> Total savings: ${totalSaved} kg CO₂</span>
                </div>

                <div class="tribe-members-list" style="flex-grow: 1;">
                    <h5>Tribe Members & Contributions</h5>
                    ${membersListHTML}
                </div>

                <button type="button" class="btn-secondary btn-full-width" style="margin-top: 1rem; border-color: rgba(239, 83, 80, 0.4); color: #ef5350;" onclick="leaveTribe(event)">
                    <i class="fa-solid fa-right-from-bracket"></i> Leave Tribe
                </button>
            </div>

            <div class="glass-card tribe-chat-card">
                <h4><i class="fa-solid fa-comments"></i> Tribe Chat</h4>
                <div class="chat-messages" id="tribe-chat-messages"></div>
                <div class="chat-input-area">
                    <input type="text" id="tribe-chat-input" placeholder="Type a message to your tribe...">
                    <button class="btn-chat-send" onclick="sendTribeMessage()"><i class="fa-solid fa-paper-plane"></i></button>
                </div>
            </div>
        </div>
    `;

    subscribeToTribeMessages(tribe.id);
}

function subscribeToTribeMessages(tribeId) {
    if (state.chatIntervalId) {
        clearInterval(state.chatIntervalId);
    }

    const pollChat = () => {
        fetch("/api/multiplayer/tribe/chat", {
            headers: { "Authorization": `Bearer ${state.firebaseToken}` }
        })
        .then(res => res.json())
        .then(data => {
            const chatBox = document.getElementById("tribe-chat-messages");
            if (!chatBox || !data.success) return;
            
            chatBox.innerHTML = "";
            const currentUid = state.firebaseUser ? state.firebaseUser.uid : null;

            (data.messages || []).forEach(msg => {
                const item = document.createElement("div");
                const isSelf = msg.senderUid === currentUid;
                item.className = `msg ${isSelf ? 'self' : 'tribe-msg'}`;

                let timeStr = "";
                if (msg.timestamp) {
                    const date = new Date(msg.timestamp);
                    timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                }

                item.innerHTML = `
                    <div class="msg-sender">${escapeHTML(msg.sender)} <small style="opacity: 0.5; font-size: 0.6rem; margin-left: 0.2rem;">${timeStr}</small></div>
                    <div class="msg-text">${escapeHTML(msg.text)}</div>
                `;
                chatBox.appendChild(item);
            });
            scrollChatToBottom("tribe-chat-messages");
        })
        .catch(err => console.error("Error polling chat messages:", err));
    };

    pollChat();
    state.chatIntervalId = setInterval(pollChat, 3000);
}

window.sendRealTribeMessage = function() {
    const input = document.getElementById("tribe-chat-input");
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;
    
    input.value = "";

    fetch("/api/multiplayer/tribe/chat", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${state.firebaseToken}`
        },
        body: JSON.stringify({ text: text })
    })
    .then(res => res.json())
    .then(data => {
        if (!data.success) console.error("Send message error:", data.error);
    })
    .catch(err => console.error("Error posting chat message:", err));
};

window.leaveTribe = function(event) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }
    
    window.showConfirmDialog(
        `<i class="fa-solid fa-right-from-bracket" style="color: var(--accent-red);"></i> Leave Tribe`,
        "Are you sure you want to leave this tribe? You will lose access to the tribe chat and active progression goals.",
        "Leave Tribe",
        () => {
            if (state.chatIntervalId) {
                clearInterval(state.chatIntervalId);
                state.chatIntervalId = null;
            }

            fetch("/api/multiplayer/tribe/leave", {
                method: "POST",
                headers: { "Authorization": `Bearer ${state.firebaseToken}` }
            })
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    triggerToast("👋 You left the tribe.");
                    renderTribesTab();
                } else {
                    alert("Error leaving tribe: " + data.error);
                }
            })
            .catch(err => alert("Server error: " + err.message));
        }
    );
};

window.visitRealUser = function(uid, displayName) {
    state.isVisitMode = true;
    state.visitedName = displayName;

    fetch("/api/multiplayer/user-state/" + uid, {
        headers: { "Authorization": `Bearer ${state.firebaseToken}` }
    })
    .then(res => res.json())
    .then(data => {
        if (data.success && data.state) {
            state.visitedUserData = data.state;
            state.visitedAura = getAuraDetails(state.visitedUserData.carbonScore || 150).level;
        } else {
            state.visitedUserData = {
                carbonScore: 150,
                treesCount: 0,
                solarUnits: 0,
                riverClean: false,
                wildlifeActive: false
            };
            state.visitedAura = "average";
        }
        
        const banner = document.getElementById("visit-banner");
        document.getElementById("visited-friend-name").innerText = displayName;
        banner.style.display = "flex";

        document.getElementById("tab-eco-city").click();
        renderState();
        triggerToast(`🛸 Visited ${displayName}'s EcoCity live!`);
    })
    .catch(err => {
        console.error("Error visiting user:", err);
        triggerToast("⚠️ Failed to load user's island game state.");
    });
};

function subscribeToGlobalPlanetStats() {
    updateContributeButtonText();
    if (state.globalPlanetIntervalId) {
        clearInterval(state.globalPlanetIntervalId);
        state.globalPlanetIntervalId = null;
    }

    const isRegistered = state.firebaseActive && state.firebaseUser && !state.firebaseUser.isAnonymous;
    if (!isRegistered) {
        // Restore static hardcoded values for guest mode
        const healthVal = document.getElementById("global-health-val");
        const reforested = document.getElementById("global-reforested-val");
        const carbon = document.getElementById("global-carbon-val");
        const progText = document.getElementById("event-progress-text");
        const progPct = document.getElementById("event-progress-pct");
        const progBar = document.getElementById("event-progress-bar");

        if (healthVal) healthVal.innerText = "83.4%";
        if (reforested) reforested.innerText = "12,492 Hectares";
        if (carbon) carbon.innerText = "142.5 Metric Tons";
        if (progText) progText.innerText = "Progress: 843,219 / 1,000,000 Trees";
        if (progPct) progPct.innerText = "84.3%";
        if (progBar) progBar.style.width = "84.3%";
        return;
    }

    const pollStats = () => {
        fetch("/api/multiplayer/global-stats")
            .then(res => res.json())
            .then(data => {
                const healthVal = document.getElementById("global-health-val");
                const reforested = document.getElementById("global-reforested-val");
                const carbon = document.getElementById("global-carbon-val");
                const progText = document.getElementById("event-progress-text");
                const progPct = document.getElementById("event-progress-pct");
                const progBar = document.getElementById("event-progress-bar");

                if (!data.success) return;

                const trees = data.totalTrees !== undefined ? data.totalTrees : 843219;
                const carbonValue = data.totalCarbon !== undefined ? data.totalCarbon : 142500;
                
                const extraTrees = Math.max(0, trees - 843219);
                const dynamicHealth = Math.min(100, parseFloat((83.4 + (extraTrees * 0.05)).toFixed(2)));

                if (healthVal) healthVal.innerText = `${dynamicHealth}%`;
                if (reforested) reforested.innerText = `${(trees / 80).toFixed(0)} Hectares`;
                if (carbon) carbon.innerText = `${(carbonValue / 1000).toFixed(1)} Metric Tons`;

                const target = 1000000;
                const eventPct = Math.min(100, parseFloat(((trees / target) * 100).toFixed(1)));
                
                if (progText) progText.innerText = `Progress: ${trees.toLocaleString()} / ${target.toLocaleString()} Trees`;
                if (progPct) progPct.innerText = `${eventPct}%`;
                if (progBar) progBar.style.width = `${eventPct}%`;
            })
            .catch(err => console.error("Global stats loading error:", err));
    };

    pollStats();
    state.globalPlanetIntervalId = setInterval(pollStats, 5000);
}

function renderBattleTab() {
    const container = document.getElementById("battle-tab-container");
    if (!container) return;

    const isRegistered = state.firebaseActive && state.firebaseUser && !state.firebaseUser.isAnonymous;
    if (!isRegistered) {
        container.innerHTML = `
            <div class="battle-arena">
                <div class="glass-card battle-card">
                    <div class="battle-fighters">
                        <div class="fighter player-one">
                            <div class="fighter-avatar aura-very-low"><i class="fa-solid fa-user-astronaut"></i></div>
                            <h4>Guest (You)</h4>
                            <span class="fighter-aura emerald">Emerald Aura</span>
                            <div class="fighter-scores">
                                <div><span>Transport:</span> <strong>Low</strong></div>
                                <div><span>Energy:</span> <strong>Efficient</strong></div>
                                <div><span>Diet:</span> <strong>Green</strong></div>
                            </div>
                        </div>

                        <div class="versus-divider">VS</div>

                        <div class="fighter player-two">
                            <div class="fighter-avatar aura-high"><i class="fa-solid fa-user-ninja"></i></div>
                            <h4>Sarah</h4>
                            <span class="fighter-aura orange">Orange Smog Aura</span>
                            <div class="fighter-scores">
                                <div><span>Transport:</span> <strong>Average</strong></div>
                                <div><span>Energy:</span> <strong>High Usage</strong></div>
                                <div><span>Diet:</span> <strong>Mixed</strong></div>
                            </div>
                        </div>
                    </div>

                    <div class="battle-actions">
                        <button class="btn-battle" id="btn-run-battle" onclick="runCarbonBattle()">
                            <i class="fa-solid fa-swords"></i> Execute Carbon Battle!
                        </button>
                    </div>

                    <div class="battle-outcome" id="battle-outcome" style="display: none;"></div>
                </div>
            </div>
        `;
        return;
    }

    container.innerHTML = `
        <div style="display: flex; justify-content: center; align-items: center; padding: 2rem;">
            <i class="fa-solid fa-spinner-third spin" style="font-size: 2rem; color: var(--accent-emerald);"></i>
            <span style="margin-left: 1rem; color: var(--text-secondary);">Loading registered opponents...</span>
        </div>
    `;

    fetch("/api/multiplayer/users", {
        headers: { "Authorization": `Bearer ${state.firebaseToken}` }
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            state.registeredOpponents = data.users || [];
            renderBattleArenaUI(container);
        } else {
            container.innerHTML = `<div class="glass-card"><p>Error: ${data.error}</p></div>`;
        }
    })
    .catch(err => {
        console.error("Error loading battle opponents:", err);
        container.innerHTML = `<div class="glass-card"><p>Error connecting to EcoVerse: ${err.message}</p></div>`;
    });
}

function renderBattleArenaUI(container) {
    const currentDisplayName = state.firebaseUser.displayName || (state.firebaseUser.email ? state.firebaseUser.email.split('@')[0] : "Registered User");
    const myAura = getAuraDetails(state.carbonScore);

    const myTransport = state.carbonScore < 100 ? "Low Footprint" : "Average";
    const myEnergy = state.solarUnits > 0 ? "Efficient (Solar)" : "High Usage";
    const myDiet = state.naturePoints > 200 ? "Green Diet" : "Mixed";

    const opponents = state.registeredOpponents || [];
    let selectHTML = "";
    if (opponents.length === 0) {
        selectHTML = `<option value="">No opponents available</option>`;
    } else {
        selectHTML = `
            <option value="">-- Select Opponent --</option>
            ${opponents.map(o => `<option value="${o.uid}">${escapeHTML(o.displayName)}</option>`).join("")}
        `;
    }

    container.innerHTML = `
        <div class="battle-arena">
            <div class="glass-card battle-card">
                <div style="margin-bottom: 1.5rem; text-align: center;">
                    <label for="opponent-select" style="font-size: 0.8rem; font-weight: 700; text-transform: uppercase; color: var(--text-muted); display: block; margin-bottom: 0.5rem;">Choose Registered Opponent</label>
                    <select id="opponent-select" style="background: rgba(0,0,0,0.4); border: 1px solid var(--border-glass); border-radius: 6px; padding: 0.5rem 1rem; color: #fff; font-size: 0.85rem; width: 100%; max-width: 320px; text-align-last: center;" onchange="selectOpponentForBattle(this.value)">
                        ${selectHTML}
                    </select>
                </div>

                <div class="battle-fighters">
                    <div class="fighter player-one">
                        <div class="fighter-avatar" style="box-shadow: 0 0 15px ${myAura.color}; background-color: rgba(255,255,255,0.05);"><i class="fa-solid fa-user-astronaut" style="color: ${myAura.color};"></i></div>
                        <h4>${escapeHTML(currentDisplayName)} (You)</h4>
                        <span class="fighter-aura" style="color: ${myAura.color};">${myAura.name}</span>
                        <div class="fighter-scores">
                            <div><span>Transport:</span> <strong style="color: ${myTransport === 'Low Footprint' ? 'var(--accent-emerald)' : 'var(--text-muted)'}">${myTransport}</strong></div>
                            <div><span>Energy:</span> <strong style="color: ${myEnergy.startsWith('Efficient') ? 'var(--accent-emerald)' : 'var(--text-muted)'}">${myEnergy}</strong></div>
                            <div><span>Diet:</span> <strong style="color: ${myDiet === 'Green Diet' ? 'var(--accent-emerald)' : 'var(--text-muted)'}">${myDiet}</strong></div>
                        </div>
                    </div>

                    <div class="versus-divider">VS</div>

                    <div class="fighter player-two" id="battle-opponent-box">
                        <div class="fighter-avatar" style="background-color: rgba(255,255,255,0.02); opacity: 0.5;"><i class="fa-solid fa-circle-question" style="color: var(--text-muted);"></i></div>
                        <h4>Select Opponent</h4>
                        <span class="fighter-aura" style="color: var(--text-muted);">--</span>
                        <div class="fighter-scores">
                            <div><span>Transport:</span> <strong>?</strong></div>
                            <div><span>Energy:</span> <strong>?</strong></div>
                            <div><span>Diet:</span> <strong>?</strong></div>
                        </div>
                    </div>
                </div>

                <div class="battle-actions" style="margin-top: 1.5rem;">
                    <button class="btn-battle" id="btn-run-battle" onclick="runCarbonBattle()" disabled style="opacity: 0.5;">
                        <i class="fa-solid fa-swords"></i> Select Opponent First
                    </button>
                </div>

                <div class="battle-outcome" id="battle-outcome" style="display: none;"></div>
            </div>
        </div>
    `;
}

window.selectOpponentForBattle = function(uid) {
    const oppBox = document.getElementById("battle-opponent-box");
    const battleBtn = document.getElementById("btn-run-battle");
    const outcomeDiv = document.getElementById("battle-outcome");
    if (!oppBox || !battleBtn) return;

    if (outcomeDiv) {
        outcomeDiv.style.display = "none";
        outcomeDiv.innerHTML = "";
    }

    if (!uid) {
        oppBox.innerHTML = `
            <div class="fighter-avatar" style="background-color: rgba(255,255,255,0.02); opacity: 0.5;"><i class="fa-solid fa-circle-question" style="color: var(--text-muted);"></i></div>
            <h4>Select Opponent</h4>
            <span class="fighter-aura" style="color: var(--text-muted);">--</span>
            <div class="fighter-scores">
                <div><span>Transport:</span> <strong>?</strong></div>
                <div><span>Energy:</span> <strong>?</strong></div>
                <div><span>Diet:</span> <strong>?</strong></div>
            </div>
        `;
        battleBtn.disabled = true;
        battleBtn.style.opacity = "0.5";
        battleBtn.innerHTML = `<i class="fa-solid fa-swords"></i> Select Opponent First`;
        state.selectedBattleOpponent = null;
        return;
    }

    const opponent = state.registeredOpponents.find(o => o.uid === uid);
    if (!opponent) return;

    state.selectedBattleOpponent = opponent;
    const oppAura = getAuraDetails(opponent.carbonScore || 150);
    const oppTransport = (opponent.carbonScore || 150) < 100 ? "Low Footprint" : "Average";
    const oppEnergy = (opponent.solarUnits || 0) > 0 ? "Efficient (Solar)" : "High Usage";
    const oppDiet = (opponent.naturePoints || 0) > 200 ? "Green Diet" : "Mixed";

    oppBox.innerHTML = `
        <div class="fighter-avatar" style="box-shadow: 0 0 15px ${oppAura.color}; background-color: rgba(255,255,255,0.05);"><i class="fa-solid fa-user-ninja" style="color: ${oppAura.color};"></i></div>
        <h4>${escapeHTML(opponent.displayName)}</h4>
        <span class="fighter-aura" style="color: ${oppAura.color};">${oppAura.name}</span>
        <div class="fighter-scores">
            <div><span>Transport:</span> <strong style="color: ${oppTransport === 'Low Footprint' ? 'var(--accent-emerald)' : 'var(--text-muted)'}">${oppTransport}</strong></div>
            <div><span>Energy:</span> <strong style="color: ${oppEnergy.startsWith('Efficient') ? 'var(--accent-emerald)' : 'var(--text-muted)'}">${oppEnergy}</strong></div>
            <div><span>Diet:</span> <strong style="color: ${oppDiet === 'Green Diet' ? 'var(--accent-emerald)' : 'var(--text-muted)'}">${oppDiet}</strong></div>
        </div>
    `;

    battleBtn.disabled = false;
    battleBtn.style.opacity = "1";
    battleBtn.innerHTML = `<i class="fa-solid fa-swords"></i> Execute Carbon Battle!`;
};

window.showConfirmDialog = function(title, message, okText, onConfirm, showCancel = true) {
    const overlay = document.getElementById("confirm-overlay");
    const titleEl = document.getElementById("confirm-title");
    const messageEl = document.getElementById("confirm-message");
    const cancelBtn = document.getElementById("confirm-cancel-btn");
    const okBtn = document.getElementById("confirm-ok-btn");
    
    if (!overlay || !titleEl || !messageEl || !cancelBtn || !okBtn) {
        if (showCancel) {
            if (confirm(message)) {
                if (onConfirm) onConfirm();
            }
        } else {
            alert(message);
            if (onConfirm) onConfirm();
        }
        return;
    }
    
    titleEl.innerHTML = title;
    messageEl.innerHTML = message;
    okBtn.innerText = okText || "Confirm";
    
    if (showCancel) {
        cancelBtn.style.display = "inline-block";
    } else {
        cancelBtn.style.display = "none";
    }
    
    const closeConfirm = () => {
        overlay.style.display = "none";
        cancelBtn.onclick = null;
        okBtn.onclick = null;
    };
    
    cancelBtn.onclick = () => {
        closeConfirm();
    };
    
    okBtn.onclick = () => {
        closeConfirm();
        if (onConfirm) onConfirm();
    };
    
    overlay.style.display = "flex";
};

window.showAlert = function(title, message, onOk) {
    window.showConfirmDialog(title, message, "OK", onOk, false);
};

// Settings Modal Functions
window.openSettingsModal = function() {
    const overlay = document.getElementById("settings-overlay");
    const keyInput = document.getElementById("custom-gemini-key");
    if (overlay && keyInput) {
        keyInput.value = localStorage.getItem("custom_gemini_api_key") || "";
        overlay.style.display = "flex";
    }
};

window.closeSettingsModal = function() {
    const overlay = document.getElementById("settings-overlay");
    if (overlay) {
        overlay.style.display = "none";
    }
};

window.toggleSettingsKeyVisibility = function() {
    const keyInput = document.getElementById("custom-gemini-key");
    const toggleIcon = document.getElementById("settings-key-toggle-icon");
    if (keyInput && toggleIcon) {
        if (keyInput.type === "password") {
            keyInput.type = "text";
            toggleIcon.className = "fa-solid fa-eye-slash";
        } else {
            keyInput.type = "password";
            toggleIcon.className = "fa-solid fa-eye";
        }
    }
};

window.saveSettings = function() {
    const keyInput = document.getElementById("custom-gemini-key");
    if (keyInput) {
        const key = keyInput.value.trim();
        if (key) {
            localStorage.setItem("custom_gemini_api_key", key);
            triggerToast("🔑 Custom Gemini API Key saved locally!");
        } else {
            localStorage.removeItem("custom_gemini_api_key");
            triggerToast("ℹ️ Custom Gemini API Key cleared.");
        }
        window.updateSettingsUI();
        window.closeSettingsModal();
    }
};

window.updateSettingsUI = function() {
    const badge = document.getElementById("settings-key-badge");
    const customKey = localStorage.getItem("custom_gemini_api_key");
    if (badge) {
        if (customKey) {
            badge.style.display = "block";
            badge.title = "Custom Gemini API Key Active";
        } else {
            badge.style.display = "none";
        }
    }
};


