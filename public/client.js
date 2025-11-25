// ==================== CONFIGURATION CLIENT ====================
const WORLD_SIZE = 15000;
const PLAYER_RADIUS = 20;

// Éléments DOM
const menuScreen = document.getElementById('menu-screen');
const gameScreen = document.getElementById('game-screen');
const deathScreen = document.getElementById('death-screen');
const playButton = document.getElementById('play-button');
const typeButtons = document.querySelectorAll('.type-button');
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');

// État du client
let socket;
let playerId = null;
let gameInitialized = false;
let otherPlayers = new Map();
let networkProjectiles = [];
let fragments = [];
let keys = { 'z': false, 's': false, 'q': false, 'd': false };
let mouse = { x: 0, y: 0 };
let camera = { x: 0, y: 0 };
let screenWidth, screenHeight;
let selectedType = null;
let currentRoom = 'principal';
let roomPlayers = new Map();

// Joueur local (données d'affichage seulement)
const localPlayer = {
    x: WORLD_SIZE / 2,
    y: WORLD_SIZE / 2,
    type: null,
    name: '',
    level: 1,
    hp: 100,
    maxHp: 100,
    radius: PLAYER_RADIUS,
    alive: true,
    room: 'principal'
};

// ==================== RÉSEAU ====================
function initNetwork() {
    socket = io();

    socket.on('connect', () => {
        updateConnectionStatus('🟢 Connecté', '#00ff00');
        console.log('🔗 Connecté au serveur');
    });

    socket.on('disconnect', () => {
        updateConnectionStatus('🔴 Déconnecté', '#ff0000');
        console.log('❌ Déconnecté du serveur');
    });

    // Initialisation du jeu
    socket.on('gameInit', (data) => {
        playerId = data.playerId;
        gameInitialized = true;
        console.log('🎮 Jeu initialisé, ID:', playerId);
    });

    // Message de bienvenue dans un salon
    socket.on('welcomeMessage', (data) => {
        console.log(`🎪 Bienvenue dans le salon: ${data.room}`);
        currentRoom = data.room;
        playerId = data.playerId;
        updateRoomInfo();
    });

    // Mise à jour des joueurs du salon
    socket.on('roomUpdate', (data) => {
        roomPlayers.clear();
        data.players.forEach(player => {
            roomPlayers.set(player.id, player);
        });
        updateRoomInfo();
        updatePlayersList();
    });

    // État du jeu du serveur
    socket.on('gameState', (gameState) => {
        if (!gameInitialized) return;

        otherPlayers.clear();
        
        gameState.players.forEach(playerData => {
            if (playerData.id === playerId) {
                Object.assign(localPlayer, playerData);
                updatePlayerUI();
            } else {
                otherPlayers.set(playerData.id, playerData);
            }
        });

        networkProjectiles = gameState.projectiles;
        updatePlayersList();
    });

    // Effets de tir
    socket.on('shootEffect', (effect) => {
        createShootEffect(effect.x, effect.y, effect.angle, effect.type);
    });

    // Joueur touché
    socket.on('playerHit', (data) => {
        if (data.playerId === playerId) {
            createDamageEffect(localPlayer.x, localPlayer.y);
            updatePlayerUI();
        }
    });

    // Joueur mort
    socket.on('playerDied', (data) => {
        if (data.playerId === playerId) {
            showDeathScreen(data.killerId);
        }
        createExplosionEffect(data.playerId);
    });
}

function updateConnectionStatus(text, color) {
    const status = document.getElementById('connection-status');
    if (status) {
        status.textContent = text;
        status.style.borderColor = color;
    }
}

function updateRoomInfo() {
    const roomElement = document.getElementById('current-room');
    if (roomElement) {
        roomElement.textContent = currentRoom;
    }
}

function sendInputToServer() {
    if (!socket || !gameInitialized) return;
    
    socket.emit('playerInput', {
        keys: { ...keys },
        mouse: { ...mouse },
        timestamp: Date.now()
    });
}

function joinRoom(roomName = 'principal') {
    if (!socket) return;
    
    const playerName = document.getElementById('player-name-input')?.value || 
                      `Mage_${Math.random().toString(36).substr(2, 4)}`;
    
    socket.emit('joinRoom', {
        room: roomName,
        playerData: {
            type: selectedType,
            name: playerName
        }
    });
    
    localPlayer.name = playerName;
}

// ==================== EFFETS VISUELS ====================
class Fragment {
    constructor(x, y, velX, velY, color, size = 3) {
        this.x = x; 
        this.y = y; 
        this.velX = velX; 
        this.velY = velY;
        this.color = color; 
        this.radius = size; 
        this.life = 100;
    }
    
    update() {
        this.x += this.velX; 
        this.y += this.velY;
        this.velX *= 0.95; 
        this.velY *= 0.95;
        this.life -= 2;
    }
    
    draw(ctx, cameraX, cameraY) {
        const screenX = this.x - cameraX;
        const screenY = this.y - cameraY;
        const opacity = this.life / 100;
        
        ctx.save();
        ctx.globalAlpha = opacity;
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(screenX, screenY, this.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

function createShootEffect(x, y, angle, type) {
    const colors = {
        'FEU': '#ff4500',
        'EAU': '#00bfff', 
        'TERRE': '#8b4513',
        'VENT': '#e0ffff'
    };
    
    const color = colors[type] || '#ffffff';
    
    for (let i = 0; i < 5; i++) {
        const spread = (Math.random() - 0.5) * 0.5;
        const speed = Math.random() * 3 + 2;
        const velX = Math.cos(angle + spread) * speed;
        const velY = Math.sin(angle + spread) * speed;
        fragments.push(new Fragment(x, y, velX, velY, color, 2));
    }
}

function createDamageEffect(x, y) {
    for (let i = 0; i < 8; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 4 + 2;
        const velX = Math.cos(angle) * speed;
        const velY = Math.sin(angle) * speed;
        fragments.push(new Fragment(x, y, velX, velY, '#ff0000', 3));
    }
}

function createExplosionEffect(playerId) {
    const player = playerId === playerId ? localPlayer : otherPlayers.get(playerId);
    if (!player) return;
    
    for (let i = 0; i < 15; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 6 + 3;
        const velX = Math.cos(angle) * speed;
        const velY = Math.sin(angle) * speed;
        fragments.push(new Fragment(player.x, player.y, velX, velY, '#ff3333', 4));
    }
}

// ==================== DESSIN ====================
function drawGame() {
    // Fond
    ctx.fillStyle = '#050510';
    ctx.fillRect(0, 0, screenWidth, screenHeight);
    
    const cameraX = camera.x;
    const cameraY = camera.y;
    
    // Grille
    drawGrid(ctx, cameraX, cameraY);
    
    // Bordures du monde
    ctx.strokeStyle = '#00ff00';
    ctx.lineWidth = 5;
    ctx.strokeRect(-cameraX, -cameraY, WORLD_SIZE, WORLD_SIZE);
    
    // Projectiles
    networkProjectiles.forEach(projectile => {
        drawProjectile(ctx, projectile, cameraX, cameraY);
    });
    
    // Autres joueurs (seulement ceux du même salon)
    otherPlayers.forEach(player => {
        if (player.alive && player.room === currentRoom) {
            drawPlayer(ctx, player, cameraX, cameraY, false);
        }
    });
    
    // Joueur local
    if (localPlayer.alive) {
        drawPlayer(ctx, localPlayer, cameraX, cameraY, true);
    }
    
    // Fragments
    fragments.forEach(f => f.draw(ctx, cameraX, cameraY));
}

function drawGrid(ctx, cameraX, cameraY) {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 1;
    
    const gridSize = 100;
    const startX = Math.floor(cameraX / gridSize) * gridSize;
    const startY = Math.floor(cameraY / gridSize) * gridSize;
    
    ctx.beginPath();
    for (let x = startX; x < cameraX + screenWidth; x += gridSize) {
        ctx.moveTo(x - cameraX, 0);
        ctx.lineTo(x - cameraX, screenHeight);
    }
    for (let y = startY; y < cameraY + screenHeight; y += gridSize) {
        ctx.moveTo(0, y - cameraY);
        ctx.lineTo(screenWidth, y - cameraY);
    }
    ctx.stroke();
}

function drawPlayer(ctx, player, cameraX, cameraY, isLocal) {
    const screenX = player.x - cameraX;
    const screenY = player.y - cameraY;
    
    ctx.save();
    ctx.translate(screenX, screenY);
    
    // Cercle de sélection
    ctx.strokeStyle = isLocal ? '#00ff00' : '#ffffff';
    ctx.lineWidth = isLocal ? 3 : 2;
    ctx.setLineDash(isLocal ? [5, 5] : []);
    ctx.beginPath();
    ctx.arc(0, 0, player.radius + 5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    
    // Corps du joueur selon le type
    const colors = {
        'FEU': '#ff4500',
        'EAU': '#00bfff',
        'TERRE': '#8b4513', 
        'VENT': '#e0ffff'
    };
    
    ctx.fillStyle = colors[player.type] || '#ffffff';
    ctx.beginPath();
    ctx.arc(0, 0, player.radius, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.restore();
    
    // Barre de vie
    drawHealthBar(ctx, screenX, screenY, player);
    
    // Nom et niveau
    ctx.fillStyle = isLocal ? '#00ff00' : '#ffffff';
    ctx.font = '12px Orbitron';
    ctx.textAlign = 'center';
    ctx.fillText(
        `${player.name} - Niv.${player.level}`,
        screenX,
        screenY + player.radius + 25
    );
}

function drawHealthBar(ctx, screenX, screenY, player) {
    const barWidth = player.radius * 3;
    const barHeight = 6;
    const yOffset = player.radius + 15;
    
    const healthRatio = player.hp / player.maxHp;
    
    // Fond
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(screenX - barWidth/2, screenY - yOffset, barWidth, barHeight);
    
    // Vie
    ctx.fillStyle = healthRatio > 0.6 ? '#00ff00' : 
                   healthRatio > 0.3 ? '#ffff00' : '#ff0000';
    ctx.fillRect(screenX - barWidth/2, screenY - yOffset, barWidth * healthRatio, barHeight);
}

function drawProjectile(ctx, projectile, cameraX, cameraY) {
    const screenX = projectile.x - cameraX;
    const screenY = projectile.y - cameraY;
    
    ctx.save();
    ctx.translate(screenX, screenY);
    ctx.rotate(projectile.angle);
    
    ctx.fillStyle = projectile.color;
    ctx.shadowColor = projectile.color;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(0, 0, projectile.radius, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.restore();
}

// ==================== UI ====================
function updatePlayerUI() {
    document.getElementById('level').textContent = localPlayer.level;
    document.getElementById('hp').textContent = Math.max(0, localPlayer.hp);
    document.getElementById('max-hp').textContent = localPlayer.maxHp;
    document.getElementById('player-type').textContent = localPlayer.type || '-';
}

function updatePlayersList() {
    const container = document.getElementById('players-container');
    if (!container) return;
    
    container.innerHTML = '';
    
    // Ajouter le joueur local
    addPlayerToList(localPlayer, true);
    
    // Ajouter les autres joueurs du même salon
    otherPlayers.forEach(player => {
        if (player.room === currentRoom) {
            addPlayerToList(player, false);
        }
    });
}

function addPlayerToList(player, isLocal) {
    const container = document.getElementById('players-container');
    const entry = document.createElement('div');
    entry.className = 'player-entry';
    
    const healthRatio = player.hp / player.maxHp;
    const healthColor = healthRatio > 0.6 ? '#00ff00' : 
                       healthRatio > 0.3 ? '#ffff00' : '#ff0000';
    
    entry.innerHTML = `
        <span style="color: ${isLocal ? '#00ff00' : '#ffffff'}">
            ${player.name} ${isLocal ? '(Vous)' : ''}
        </span>
        <div style="display: flex; align-items: center; gap: 10px;">
            <div class="player-health">
                <div class="health-bar" style="width: ${healthRatio * 100}%; background: ${healthColor};"></div>
            </div>
            <span>N.${player.level}</span>
        </div>
    `;
    
    container.appendChild(entry);
}

function showDeathScreen(killerId) {
    const killer = otherPlayers.get(killerId);
    const killerInfo = document.getElementById('killer-info');
    
    if (killer) {
        killerInfo.textContent = `Tué par ${killer.name} (Niv.${killer.level})`;
    } else {
        killerInfo.textContent = '';
    }
    
    deathScreen.style.display = 'flex';
    
    let countdown = 3;
    const counter = document.getElementById('respawn-counter');
    
    const interval = setInterval(() => {
        countdown--;
        counter.textContent = countdown;
        
        if (countdown <= 0) {
            clearInterval(interval);
            deathScreen.style.display = 'none';
        }
    }, 1000);
}

// ==================== BOUCLE DE JEU ====================
function gameLoop() {
    // Mettre à jour la caméra
    if (localPlayer.alive) {
        camera.x = localPlayer.x - screenWidth / 2;
        camera.y = localPlayer.y - screenHeight / 2;
    }
    
    // Envoyer les inputs au serveur
    sendInputToServer();
    
    // Mettre à jour les fragments
    fragments = fragments.filter(f => {
        f.update();
        return f.life > 0;
    });
    
    // Dessiner
    drawGame();
    
    requestAnimationFrame(gameLoop);
}

// ==================== ÉVÉNEMENTS ====================
function handleShoot(e) {
    if (!socket || !gameInitialized || !localPlayer.alive) return;
    
    const dx = e.clientX - screenWidth / 2;
    const dy = e.clientY - screenHeight / 2;
    const angle = Math.atan2(dy, dx);
    
    socket.emit('playerShoot', {
        angle: angle,
        timestamp: Date.now()
    });
}

// Événements clavier
window.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();
    if (['z', 's', 'q', 'd'].includes(key)) {
        keys[key] = true;
        e.preventDefault();
    }
});

window.addEventListener('keyup', (e) => {
    const key = e.key.toLowerCase();
    if (['z', 's', 'q', 'd'].includes(key)) {
        keys[key] = false;
    }
});

// Événements souris
window.addEventListener('mousemove', (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
});

canvas.addEventListener('click', handleShoot);

// Sélection du type
typeButtons.forEach(button => {
    button.addEventListener('click', () => {
        typeButtons.forEach(btn => btn.classList.remove('selected'));
        button.classList.add('selected');
        selectedType = button.getAttribute('data-type');
        playButton.disabled = false;
        
        // Afficher la sélection de salon
        document.getElementById('room-selection').style.display = 'block';
    });
});

// Bouton jouer
playButton.addEventListener('click', () => {
    if (!selectedType) return;
    
    const roomInput = document.getElementById('room-input');
    const roomName = roomInput?.value.trim() || 'principal';
    
    joinRoom(roomName);
    
    localPlayer.type = selectedType;
    
    menuScreen.style.display = 'none';
    gameScreen.style.display = 'flex';
    
    gameLoop();
});

// Bouton rejoindre salon
document.getElementById('join-room-btn')?.addEventListener('click', () => {
    const roomInput = document.getElementById('room-input');
    const roomName = roomInput.value.trim() || 'principal';
    
    if (socket && socket.connected) {
        joinRoom(roomName);
    }
});

// Redimensionnement
window.addEventListener('resize', () => {
    screenWidth = window.innerWidth;
    screenHeight = window.innerHeight;
    canvas.width = screenWidth;
    canvas.height = screenHeight;
});

// Initialisation
window.onload = () => {
    screenWidth = window.innerWidth;
    screenHeight = window.innerHeight;
    canvas.width = screenWidth;
    canvas.height = screenHeight;
    
    initNetwork();
};