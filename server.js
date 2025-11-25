import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = createServer(app);
const io = new Server(server, { 
  cors: { 
    origin: "*", // Autorise toutes les origines pour le multijoueur
    methods: ["GET", "POST"]
  } 
});

const PORT = process.env.PORT || 3000;

// Servir les fichiers statiques
app.use(express.static(path.join(__dirname, 'public')));

// Route racine
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Route pour avoir un lien de statut
app.get('/status', (req, res) => {
  res.json({
    status: 'online',
    players: Array.from(gameState.players.values()).filter(p => p.alive).length,
    totalPlayers: gameState.players.size,
    rooms: Array.from(rooms.keys()),
    uptime: process.uptime(),
    message: 'Mage PVP Game Server - Prêt pour le combat !'
  });
});

// ==================== CONFIGURATION DU JEU ====================
const WORLD_SIZE = 15000;
const PLAYER_SPEED = 0.3;
const MAX_VELOCITY = 4;
const PLAYER_RADIUS = 20;
const FRICTION = 0.90;
const BASE_PROJECTILE_DAMAGE = 10;
const PROJECTILE_DURATION = 2000;

const PLAYER_TYPES = {
  'FEU': { name: 'Feu', color: '#ff4500', damageModifier: 1.2, speedModifier: 1.0, baseProjectileSpeed: 10 },
  'EAU': { name: 'Eau', color: '#00bfff', damageModifier: 1.0, speedModifier: 1.1, baseProjectileSpeed: 10 },
  'TERRE': { name: 'Terre', color: '#8b4513', damageModifier: 1.1, speedModifier: 0.9, baseProjectileSpeed: 10 },
  'VENT': { name: 'Vent', color: '#e0ffff', damageModifier: 0.8, speedModifier: 1.2, baseProjectileSpeed: 10 }
};

// ==================== CLASSES SERVEUR ====================
class ServerPlayer {
  constructor(id, type, name) {
    this.id = id;
    this.type = type;
    this.name = name;
    this.x = Math.random() * (WORLD_SIZE - 2000) + 1000;
    this.y = Math.random() * (WORLD_SIZE - 2000) + 1000;
    this.velX = 0;
    this.velY = 0;
    this.radius = PLAYER_RADIUS;
    this.level = 1;
    this.xp = 0;
    this.hp = 100;
    this.maxHp = 100;
    this.lastInput = { keys: {}, mouse: { x: 0, y: 0 } };
    this.typeProps = PLAYER_TYPES[type];
    this.alive = true;
    this.respawnTime = 0;
    this.room = 'principal';
  }

  update(input, deltaTime) {
    if (!this.alive) {
      this.respawnTime -= deltaTime;
      if (this.respawnTime <= 0) {
        this.respawn();
      }
      return;
    }

    this.lastInput = input;
    
    // MOUVEMENT
    let accelX = 0, accelY = 0;
    const speed = PLAYER_SPEED * this.typeProps.speedModifier;

    if (input.keys['z']) accelY -= speed;
    if (input.keys['s']) accelY += speed;
    if (input.keys['q']) accelX -= speed;
    if (input.keys['d']) accelX += speed;

    this.velX += accelX * deltaTime;
    this.velY += accelY * deltaTime;
    this.velX *= FRICTION;
    this.velY *= FRICTION;

    const currentVelocity = Math.sqrt(this.velX * this.velX + this.velY * this.velY);
    if (currentVelocity > MAX_VELOCITY) {
      const ratio = MAX_VELOCITY / currentVelocity;
      this.velX *= ratio;
      this.velY *= ratio;
    }

    this.x += this.velX;
    this.y += this.velY;
    
    // COLLISIONS MURS
    this.x = Math.max(this.radius, Math.min(WORLD_SIZE - this.radius, this.x));
    this.y = Math.max(this.radius, Math.min(WORLD_SIZE - this.radius, this.y));
  }

  takeDamage(damage, attackerId) {
    this.hp = Math.max(0, this.hp - damage);
    
    if (this.hp <= 0 && this.alive) {
      this.alive = false;
      this.respawnTime = 3000; // 3 secondes
      return { died: true, attackerId };
    }
    
    return { died: false };
  }

  respawn() {
    this.x = Math.random() * (WORLD_SIZE - 2000) + 1000;
    this.y = Math.random() * (WORLD_SIZE - 2000) + 1000;
    this.hp = this.maxHp;
    this.velX = 0;
    this.velY = 0;
    this.alive = true;
  }

  toClientData() {
    return {
      id: this.id,
      x: this.x,
      y: this.y,
      velX: this.velX,
      velY: this.velY,
      type: this.type,
      name: this.name,
      level: this.level,
      hp: this.hp,
      maxHp: this.maxHp,
      radius: this.radius,
      alive: this.alive,
      room: this.room
    };
  }
}

class ServerProjectile {
  constructor(shooterId, x, y, angle, type) {
    this.id = Math.random().toString(36).substr(2, 9);
    this.shooterId = shooterId;
    this.x = x;
    this.y = y;
    this.angle = angle;
    this.type = type;
    this.damage = BASE_PROJECTILE_DAMAGE * PLAYER_TYPES[type].damageModifier;
    this.speed = PLAYER_TYPES[type].baseProjectileSpeed;
    this.velX = Math.cos(angle) * this.speed;
    this.velY = Math.sin(angle) * this.speed;
    this.radius = 10;
    this.spawnTime = Date.now();
    this.color = PLAYER_TYPES[type].color;
    this.room = 'principal';
  }

  update(deltaTime) {
    this.x += this.velX;
    this.y += this.velY;
    
    // Collision avec les bords
    if (this.x < 0 || this.x > WORLD_SIZE || this.y < 0 || this.y > WORLD_SIZE) {
      return { hit: true };
    }
    
    return { hit: false };
  }

  isExpired() {
    return Date.now() - this.spawnTime > PROJECTILE_DURATION;
  }

  toClientData() {
    return {
      id: this.id,
      x: this.x,
      y: this.y,
      angle: this.angle,
      type: this.type,
      color: this.color,
      radius: this.radius,
      room: this.room
    };
  }
}

// ==================== GESTION DES SALONS ====================
const rooms = new Map();

class GameRoom {
  constructor(name) {
    this.name = name;
    this.players = new Map();
    this.createdAt = Date.now();
  }
  
  addPlayer(playerId, playerData) {
    this.players.set(playerId, playerData);
    playerData.room = this.name;
  }
  
  removePlayer(playerId) {
    this.players.delete(playerId);
  }
  
  getPlayerCount() {
    return this.players.size;
  }
  
  getPlayersData() {
    return Array.from(this.players.values()).map(p => p.toClientData());
  }
}

// Initialiser le salon principal
rooms.set('principal', new GameRoom('principal'));

// ==================== ÉTAT DU JEU SERVEUR ====================
const gameState = {
  players: new Map(),
  projectiles: [],
  lastUpdateTime: Date.now(),
  shouldSendUpdate: false
};

// ==================== BOUCLE DE JEU SERVEUR ====================
function gameLoop() {
  const now = Date.now();
  const deltaTime = Math.min(100, now - gameState.lastUpdateTime);

  // Mettre à jour les joueurs
  gameState.players.forEach((player) => {
    player.update(player.lastInput, deltaTime);
  });

  // Mettre à jour les projectiles et vérifier les collisions
  for (let i = gameState.projectiles.length - 1; i >= 0; i--) {
    const projectile = gameState.projectiles[i];
    const updateResult = projectile.update(deltaTime);

    if (updateResult.hit || projectile.isExpired()) {
      gameState.projectiles.splice(i, 1);
      continue;
    }

    // Vérifier les collisions avec les joueurs
    for (const [playerId, player] of gameState.players) {
      if (playerId === projectile.shooterId || !player.alive || player.room !== projectile.room) continue;
      
      const dx = projectile.x - player.x;
      const dy = projectile.y - player.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      if (distance < projectile.radius + player.radius) {
        const damageResult = player.takeDamage(projectile.damage, projectile.shooterId);
        
        // Événements de dégâts
        io.to(player.room).emit('playerHit', {
          playerId: playerId,
          damage: projectile.damage,
          newHp: player.hp
        });

        if (damageResult.died) {
          io.to(player.room).emit('playerDied', {
            playerId: playerId,
            killerId: damageResult.attackerId
          });
        }

        gameState.projectiles.splice(i, 1);
        break;
      }
    }
  }

  gameState.lastUpdateTime = now;
  gameState.shouldSendUpdate = true;
}

// ==================== DIFFUSION AUX CLIENTS ====================
function sendGameState() {
  if (!gameState.shouldSendUpdate) return;

  // Envoyer l'état à chaque salon
  rooms.forEach((room, roomName) => {
    if (room.getPlayerCount() > 0) {
      const roomPlayers = room.getPlayersData();
      const roomProjectiles = gameState.projectiles.filter(p => p.room === roomName);
      
      const clientState = {
        players: roomPlayers,
        projectiles: roomProjectiles.map(p => p.toClientData())
      };

      io.to(roomName).emit('gameState', clientState);
    }
  });

  gameState.shouldSendUpdate = false;
}

// ==================== SOCKET.IO ====================
io.on('connection', (socket) => {
  console.log('🔗 Nouvelle connexion:', socket.id);
  let currentRoom = 'principal';

  // REJOINDRE UN SALON
  socket.on('joinRoom', (data) => {
    const roomName = data.room || 'principal';
    const playerData = data.playerData;
    
    // Quitter l'ancien salon
    if (rooms.has(currentRoom)) {
      rooms.get(currentRoom).removePlayer(socket.id);
      socket.leave(currentRoom);
    }
    
    // Créer le salon s'il n'existe pas
    if (!rooms.has(roomName)) {
      rooms.set(roomName, new GameRoom(roomName));
      console.log(`🎪 Nouveau salon créé: ${roomName}`);
    }
    
    // Rejoindre le nouveau salon
    currentRoom = roomName;
    const room = rooms.get(roomName);
    
    const newPlayer = new ServerPlayer(
      socket.id, 
      playerData.type, 
      playerData.name || `Mage_${Math.random().toString(36).substr(2, 4)}`
    );
    
    room.addPlayer(socket.id, newPlayer);
    gameState.players.set(socket.id, newPlayer);
    socket.join(roomName);
    
    console.log(`🎮 ${newPlayer.name} a rejoint le salon ${roomName} (${room.getPlayerCount()} joueurs)`);
    
    // Informer le client
    socket.emit('welcomeMessage', {
      room: roomName,
      playerCount: room.getPlayerCount(),
      playerId: socket.id
    });
    
    // Mettre à jour tous les joueurs du salon
    io.to(roomName).emit('roomUpdate', {
      players: room.getPlayersData(),
      room: roomName
    });
    
    gameState.shouldSendUpdate = true;
  });

  // INPUTS DU JOUEUR
  socket.on('playerInput', (input) => {
    const player = gameState.players.get(socket.id);
    if (player) {
      player.lastInput = input;
    }
  });

  // TIRER
  socket.on('playerShoot', (shootData) => {
    const player = gameState.players.get(socket.id);
    if (!player || !player.alive) return;

    const projectile = new ServerProjectile(
      socket.id,
      player.x,
      player.y,
      shootData.angle,
      player.type
    );
    
    projectile.room = currentRoom;
    gameState.projectiles.push(projectile);
    gameState.shouldSendUpdate = true;

    // Effet visuel pour tous les joueurs du salon
    io.to(currentRoom).emit('shootEffect', {
      playerId: socket.id,
      x: player.x,
      y: player.y,
      angle: shootData.angle,
      type: player.type
    });
  });

  // DÉCONNEXION
  socket.on('disconnect', () => {
    console.log('❌ Déconnexion:', socket.id);
    
    if (rooms.has(currentRoom)) {
      rooms.get(currentRoom).removePlayer(socket.id);
      const room = rooms.get(currentRoom);
      
      // Informer les autres joueurs du salon
      io.to(currentRoom).emit('roomUpdate', {
        players: room.getPlayersData(),
        room: currentRoom
      });
      
      console.log(`👋 ${socket.id} a quitté le salon ${currentRoom} (${room.getPlayerCount()} joueurs restants)`);
    }
    
    gameState.players.delete(socket.id);
    gameState.shouldSendUpdate = true;
  });
});

// ==================== LANCEMENT ====================
setInterval(gameLoop, 1000 / 60); // 60 FPS
setInterval(sendGameState, 1000 / 20); // 20 FPS réseau

server.listen(PORT, () => {
  console.log(`🚀 Serveur Mage PVP démarré sur le port ${PORT}`);
  console.log(`🌍 Monde: ${WORLD_SIZE}x${WORLD_SIZE}`);
  console.log(`🎯 Mode: Server-Authoritative avec Salons`);
  console.log(`🔗 Statut: http://localhost:${PORT}/status`);
  console.log(`🎮 Jouez: http://localhost:${PORT}`);
});