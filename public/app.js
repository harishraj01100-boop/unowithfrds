// Dynamic Socket.IO connection reference
let socket = null;
let savedBackendUrl = localStorage.getItem('uno_arena_backend_url') || '';

// App State
let myPlayerId = null;
let currentRoom = null;
let currentGameState = null;
let hasDrawnCardThisTurn = false;
let pendingWildCardId = null; // Stores cardId while picking color

// Audio elements
const sounds = {
  deal: document.getElementById('sound-deal'),
  play: document.getElementById('sound-play'),
  draw: document.getElementById('sound-draw'),
  uno: document.getElementById('sound-uno'),
  penalty: document.getElementById('sound-penalty'),
  win: document.getElementById('sound-win')
};

// Helper: Play sound safely
function playSound(soundKey) {
  if (sounds[soundKey]) {
    sounds[soundKey].currentTime = 0;
    sounds[soundKey].play().catch(err => console.log('Audio playback delayed:', err));
  }
}

// DOM Elements - Screens
const lobbyScreen = document.getElementById('lobby-screen');
const waitingScreen = document.getElementById('waiting-screen');
const gameScreen = document.getElementById('game-screen');

// DOM Elements - Lobby
const playerNameInput = document.getElementById('player-name-input');
const roomCodeInput = document.getElementById('room-code-input');
const createRoomBtn = document.getElementById('create-room-btn');
const joinRoomBtn = document.getElementById('join-room-btn');

// DOM Elements - Waiting Room
const lobbyRoomCode = document.getElementById('lobby-room-code');
const copyCodeBtn = document.getElementById('copy-code-btn');
const lobbyPlayersList = document.getElementById('lobby-players-list');
const playersCount = document.getElementById('players-count');
const startGameBtn = document.getElementById('start-game-btn');
const nonHostMessage = document.getElementById('non-host-message');
const leaveRoomBtn = document.getElementById('leave-room-btn');

// DOM Elements - Chat
const chatMessages = document.getElementById('chat-messages');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const gameChatPlaceholder = document.getElementById('game-chat-placeholder');

// DOM Elements - Game Board
const gamePlayersList = document.getElementById('game-players-list');
const activePlayerName = document.getElementById('active-player-name');
const directionIcon = document.getElementById('direction-icon');
const directionText = document.getElementById('direction-text');
const deckDrawPile = document.getElementById('deck-draw-pile');
const deckCardsCount = document.getElementById('deck-cards-count');
const deckDiscardPile = document.getElementById('deck-discard-pile');
const colorAnnouncementBar = document.getElementById('color-announcement-bar');
const activeColorName = document.getElementById('active-color-name');
const gameUnoBtn = document.getElementById('game-uno-btn');
const gamePassBtn = document.getElementById('game-pass-btn');
const playerHand = document.getElementById('player-hand');
const handCardsCount = document.getElementById('hand-cards-count');

// DOM Elements - Modals
const colorPickerModal = document.getElementById('color-picker-modal');
const leaderboardModal = document.getElementById('leaderboard-modal');
const leaderboardList = document.getElementById('leaderboard-list');
const restartLobbyBtn = document.getElementById('restart-lobby-btn');
const nonHostRestartMsg = document.getElementById('non-host-restart-msg');
const quitGameBtn = document.getElementById('quit-game-btn');

// DOM Elements - Backend Settings Panel
const toggleBackendSettingsBtn = document.getElementById('toggle-backend-settings-btn');
const backendSettingsPanel = document.getElementById('backend-settings-panel');
const backendUrlInput = document.getElementById('backend-url-input');
const saveBackendUrlBtn = document.getElementById('save-backend-url-btn');
const connectionStatusBadge = document.getElementById('connection-status-badge');
const connectionStatusText = document.getElementById('connection-status-text');

// --- Screen Navigation Helpers ---
function showScreen(screen) {
  [lobbyScreen, waitingScreen, gameScreen].forEach(s => s.classList.remove('active'));
  screen.classList.add('active');
}

// Pre-fill saved backend URL
if (savedBackendUrl) {
  backendUrlInput.value = savedBackendUrl;
}

// Toggle Server Settings view
if (toggleBackendSettingsBtn) {
  toggleBackendSettingsBtn.addEventListener('click', () => {
    backendSettingsPanel.classList.toggle('hidden');
  });
}

// Connect button event handler
if (saveBackendUrlBtn) {
  saveBackendUrlBtn.addEventListener('click', () => {
    const url = backendUrlInput.value.trim();
    if (url) {
      localStorage.setItem('uno_arena_backend_url', url);
    } else {
      localStorage.removeItem('uno_arena_backend_url');
    }
    alert(`Attempting to connect to server: ${url || 'Current Website Origin'}...`);
    initSocketConnection(url);
  });
}

// Initialize Socket Connection
function initSocketConnection(url) {
  if (socket) {
    socket.disconnect();
  }

  updateConnectionStatus('connecting');

  // If custom URL is set, use it. Otherwise, connect to current origin.
  if (url) {
    socket = io(url, {
      transports: ['websocket', 'polling']
    });
  } else {
    socket = io();
  }

  bindSocketEvents();
}

function updateConnectionStatus(status) {
  if (!connectionStatusBadge) return;
  connectionStatusBadge.className = `connection-status ${status}`;
  
  if (status === 'connected') {
    connectionStatusText.innerText = 'Server: Connected';
  } else if (status === 'disconnected') {
    connectionStatusText.innerText = 'Server: Disconnected';
  } else if (status === 'connecting') {
    connectionStatusText.innerText = 'Server: Connecting...';
  }
}

// Check localStorage for saved name
const savedName = localStorage.getItem('uno_arena_player_name');
if (savedName) {
  playerNameInput.value = savedName;
}

// --- Lobby Actions ---
createRoomBtn.addEventListener('click', () => {
  const name = playerNameInput.value.trim();
  if (!name) return alert('Please enter a name first!');
  localStorage.setItem('uno_arena_player_name', name);
  socket.emit('createRoom', name);
});

joinRoomBtn.addEventListener('click', () => {
  const name = playerNameInput.value.trim();
  const code = roomCodeInput.value.trim().toUpperCase();
  if (!name) return alert('Please enter a name first!');
  if (!code || code.length !== 6) return alert('Please enter a valid 6-character room code!');
  localStorage.setItem('uno_arena_player_name', name);
  socket.emit('joinRoom', { roomCode: code, playerName: name });
});

// Copy code action
copyCodeBtn.addEventListener('click', () => {
  const code = lobbyRoomCode.innerText;
  navigator.clipboard.writeText(code).then(() => {
    alert('Room code copied to clipboard!');
  }).catch(err => {
    console.error('Clipboard copy failed:', err);
  });
});

// Leave/Quit Room
leaveRoomBtn.addEventListener('click', () => {
  window.location.reload();
});

quitGameBtn.addEventListener('click', () => {
  window.location.reload();
});

// Start Game (Host only)
startGameBtn.addEventListener('click', () => {
  socket.emit('startGame');
});

// Restart/Return to Lobby
restartLobbyBtn.addEventListener('click', () => {
  socket.emit('restartGame');
});

// --- Chat Form submit ---
chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;
  socket.emit('sendMessage', text);
  chatInput.value = '';
});

// --- Setup Socket Listeners ---
function bindSocketEvents() {
  socket.on('connect', () => {
    console.log('Connected to socket server');
    updateConnectionStatus('connected');
    myPlayerId = socket.id;
  });

  socket.on('disconnect', () => {
    console.log('Disconnected from socket server');
    updateConnectionStatus('disconnected');
  });

  socket.on('connect_error', (err) => {
    console.error('Socket connection error:', err);
    updateConnectionStatus('disconnected');
    // Open settings panel automatically on connection failure
    if (backendSettingsPanel) {
      backendSettingsPanel.classList.remove('hidden');
    }
  });

  socket.on('roomCreated', (code) => {
    myPlayerId = socket.id;
    currentRoom = code;
    lobbyRoomCode.innerText = code;
    showScreen(waitingScreen);
  });

  socket.on('roomJoined', (code) => {
    myPlayerId = socket.id;
    currentRoom = code;
    lobbyRoomCode.innerText = code;
    showScreen(waitingScreen);
  });

  socket.on('errorMsg', (msg) => {
    alert(msg);
  });

  socket.on('chatMessage', (msg) => {
    const isSystem = (msg.sender === 'System');
    const messageElement = document.createElement('div');
    messageElement.className = `chat-msg ${isSystem ? 'system' : ''}`;

    if (isSystem) {
      messageElement.innerHTML = `<span class="msg-text">${msg.text}</span>`;
    } else {
      let nameColor = '#f43f5e';
      if (msg.sender !== 'System') {
        const colors = ['#f43f5e', '#3b82f6', '#10b981', '#eab308', '#a855f7', '#06b6d4'];
        let charSum = 0;
        for (let i = 0; i < msg.sender.length; i++) {
          charSum += msg.sender.charCodeAt(i);
        }
        nameColor = colors[charSum % colors.length];
      }

      messageElement.innerHTML = `
        <div class="msg-meta">
          <span class="msg-sender" style="color: ${nameColor}">${msg.sender}</span>
          <span class="msg-time">${msg.time}</span>
        </div>
        <span class="msg-text">${msg.text}</span>
      `;
    }

    chatMessages.appendChild(messageElement);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    if (isSystem) {
      if (msg.text.includes('drew a card')) {
        playSound('draw');
      } else if (msg.text.includes('played')) {
        playSound('play');
      } else if (msg.text.includes('UNO!')) {
        playSound('penalty');
      } else if (msg.text.includes('declared UNO!')) {
        playSound('uno');
      }
    }
  });

  socket.on('cardDrawnAlert', (card) => {
    playSound('deal');
  });

  socket.on('gameStateUpdate', (state) => {
    currentGameState = state;
    console.log('State updated:', state);

    // If game is not started, we are in the waiting lobby
    if (!state.gameStarted) {
      showScreen(waitingScreen);
      
      lobbyPlayersList.innerHTML = '';
      state.players.forEach(p => {
        const li = document.createElement('li');
        li.className = 'player-item';
        
        const isMe = p.id === myPlayerId;
        const hostLabel = p.isHost ? `<span class="host-badge"><i class="fa-solid fa-crown"></i> Host</span>` : '';
        const meLabel = isMe ? ' <span style="color:var(--text-muted)">(You)</span>' : '';

        li.innerHTML = `
          <div class="player-name-wrapper">
            <div class="status-dot"></div>
            <span class="player-name">${p.name}${meLabel}</span>
          </div>
          ${hostLabel}
        `;
        lobbyPlayersList.appendChild(li);
      });

      playersCount.innerText = state.players.length;

      const myPlayer = state.players.find(p => p.id === myPlayerId);
      if (myPlayer && myPlayer.isHost) {
        startGameBtn.classList.remove('hidden');
        nonHostMessage.classList.add('hidden');
        startGameBtn.disabled = (state.players.length < 2);
      } else {
        startGameBtn.classList.add('hidden');
        nonHostMessage.classList.remove('hidden');
      }

      const chatBox = document.querySelector('.chat-container');
      const waitingLayout = document.querySelector('.waiting-layout');
      if (chatBox && waitingLayout && !waitingLayout.contains(chatBox)) {
        waitingLayout.appendChild(chatBox);
      }

      colorPickerModal.classList.remove('active');
      leaderboardModal.classList.remove('active');
      return;
    }

    // GAME RUNNING VIEW
    showScreen(gameScreen);

    // Dock chat container into sidebar on large screens
    const chatBox = document.querySelector('.chat-container');
    if (chatBox && gameChatPlaceholder && !gameChatPlaceholder.contains(chatBox)) {
      gameChatPlaceholder.appendChild(chatBox);
    }

    // 1. Render Active Players list in Game Screen
    gamePlayersList.innerHTML = '';
    state.players.forEach((p, idx) => {
      const isCurrentTurn = state.turnIndex === idx;
      const isMe = p.id === myPlayerId;
      const playerCard = document.createElement('li');
      playerCard.className = `game-player-card ${isCurrentTurn ? 'active-turn' : ''}`;

      const hostCrown = p.isHost ? '<i class="fa-solid fa-crown" style="color:#ffcc00; margin-left:3px;" title="Host"></i>' : '';
      const unoBadge = p.unoDeclared ? '<span class="uno-glow-badge">UNO!</span>' : '';
      
      const canCatch = (p.cardCount === 1 && !p.unoDeclared && !isMe);
      const catchBtn = canCatch ? `<button class="btn-catch-uno" onclick="triggerCatchUno('${p.id}')">CATCH!</button>` : '';

      playerCard.innerHTML = `
        <div class="game-player-info">
          <span class="game-player-name">
            ${p.name} ${hostCrown} ${isMe ? '<span style="font-size:0.75rem; color:var(--text-muted); font-weight:normal;">(You)</span>' : ''}
          </span>
          <span class="game-player-cards-badge">
            <i class="fa-solid fa-clone"></i> ${p.cardCount} cards
          </span>
        </div>
        <div class="game-player-actions">
          ${unoBadge}
          ${catchBtn}
        </div>
      `;
      gamePlayersList.appendChild(playerCard);
    });

    // 2. Render Turn details
    const activePlayer = state.players[state.turnIndex];
    if (activePlayer) {
      const isMyTurn = activePlayer.id === myPlayerId;
      activePlayerName.innerText = isMyTurn ? 'Your Turn!' : activePlayer.name;
      
      if (isMyTurn) {
        activePlayerName.style.color = 'var(--border-neon-green)';
      } else {
        activePlayerName.style.color = '#fff';
      }
    }

    // 3. Render Direction Indicator
    if (state.direction === 1) {
      directionIcon.className = 'fa-solid fa-arrows-rotate rotation-clockwise';
      directionText.innerText = 'Clockwise';
      directionText.style.color = 'var(--border-neon-green)';
    } else {
      directionIcon.className = 'fa-solid fa-arrows-rotate rotation-counter-clockwise';
      directionText.innerText = 'Counter-Clockwise';
      directionText.style.color = '#ef4444';
    }

    // 4. Draw Pile count update
    deckCardsCount.innerText = state.deckCount;

    // 5. Render top discard card
    deckDiscardPile.innerHTML = '';
    if (state.discardPile.length > 0) {
      const topCard = state.discardPile[state.discardPile.length - 1];
      const cardEl = createCardElement(topCard, false, null);
      deckDiscardPile.appendChild(cardEl);
      deckDiscardPile.className = `deck-pile discard-pile glow-${state.currentSelectedColor}`;
    }

    // 6. Update active color bar
    if (state.currentSelectedColor) {
      activeColorName.innerText = state.currentSelectedColor.toUpperCase();
      activeColorName.className = `color-text-${state.currentSelectedColor}`;
      colorAnnouncementBar.style.display = 'block';
    } else {
      colorAnnouncementBar.style.display = 'none';
    }

    // 7. Update HUD controls
    const mySelf = state.players.find(p => p.id === myPlayerId);
    const isMyTurn = activePlayer && activePlayer.id === myPlayerId;

    if (mySelf && mySelf.unoDeclared) {
      gameUnoBtn.classList.add('declared');
    } else {
      gameUnoBtn.classList.remove('declared');
    }

    if (isMyTurn) {
      gamePassBtn.disabled = !hasDrawnCardThisTurn;
    } else {
      gamePassBtn.disabled = true;
      hasDrawnCardThisTurn = false;
    }

    // 8. Render Player Hand
    playerHand.innerHTML = '';
    if (mySelf) {
      handCardsCount.innerText = mySelf.hand.length;

      mySelf.hand.forEach(card => {
        const isPlayable = isMyTurn && (
          card.color === 'wild' ||
          card.color === state.currentSelectedColor ||
          card.value.toString() === state.discardPile[state.discardPile.length - 1].value.toString()
        );

        const cardEl = createCardElement(card, isPlayable, () => {
          if (!isPlayable) return;
          
          if (card.color === 'wild') {
            pendingWildCardId = card.id;
            colorPickerModal.classList.add('active');
          } else {
            socket.emit('playCard', { cardId: card.id, wildColor: null });
          }
        });

        playerHand.appendChild(cardEl);
      });
    }
  });

  socket.on('gameOver', (rankings) => {
    playSound('win');
    leaderboardList.innerHTML = '';
    
    rankings.forEach((name, index) => {
      const li = document.createElement('li');
      li.className = 'leaderboard-item';

      let rankClass = 'other';
      let rankText = index + 1;
      if (index === 0) rankClass = 'gold';
      else if (index === 1) rankClass = 'silver';
      else if (index === 2) rankClass = 'bronze';

      li.innerHTML = `
        <div class="leaderboard-rank-name">
          <div class="rank-badge ${rankClass}">${rankText}</div>
          <span>${name}</span>
        </div>
        <span>${index === 0 ? '🏆 Winner' : ''}</span>
      `;
      leaderboardList.appendChild(li);
    });

    const myPlayer = currentGameState ? currentGameState.players.find(p => p.id === myPlayerId) : null;
    if (myPlayer && myPlayer.isHost) {
      restartLobbyBtn.classList.remove('hidden');
      nonHostRestartMsg.classList.add('hidden');
    } else {
      restartLobbyBtn.classList.add('hidden');
      nonHostRestartMsg.classList.remove('hidden');
    }

    leaderboardModal.classList.add('active');
  });
}

// --- Gameplay DOM Triggers ---

// Draw Card
deckDrawPile.addEventListener('click', () => {
  if (!currentGameState) return;
  const activePlayer = currentGameState.players[currentGameState.turnIndex];
  if (activePlayer.id !== myPlayerId) return; // not my turn
  if (hasDrawnCardThisTurn) return;
  socket.emit('drawCard');
});

// Pass Turn
gamePassBtn.addEventListener('click', () => {
  if (!currentGameState) return;
  const activePlayer = currentGameState.players[currentGameState.turnIndex];
  if (activePlayer.id !== myPlayerId) return;
  socket.emit('passTurn');
});

// Call UNO
gameUnoBtn.addEventListener('click', () => {
  socket.emit('declareUno');
});

// Color Picker slice clicks
document.querySelectorAll('.color-slice').forEach(slice => {
  slice.addEventListener('click', (e) => {
    const color = e.target.getAttribute('data-color');
    if (pendingWildCardId && color) {
      socket.emit('playCard', { cardId: pendingWildCardId, wildColor: color });
      colorPickerModal.classList.remove('active');
      pendingWildCardId = null;
    }
  });
});

// Close color picker on outside click
colorPickerModal.addEventListener('click', (e) => {
  if (e.target === colorPickerModal) {
    colorPickerModal.classList.remove('active');
    pendingWildCardId = null;
  }
});

// Global catch UNO trigger
window.triggerCatchUno = function(targetPlayerId) {
  socket.emit('catchUno', targetPlayerId);
};

// Card HTML Generator
function createCardElement(card, isPlayable, onClickHandler) {
  const cardDiv = document.createElement('div');
  cardDiv.className = `card ${card.color}`;
  
  if (isPlayable) {
    cardDiv.classList.add('playable');
  }

  let symbol = card.value;
  let centerSymbol = card.value;

  if (card.value === 'skip') {
    symbol = '<i class="fa-solid fa-ban"></i>';
    centerSymbol = '<i class="fa-solid fa-ban"></i>';
  } else if (card.value === 'reverse') {
    symbol = '<i class="fa-solid fa-arrows-rotate"></i>';
    centerSymbol = '<i class="fa-solid fa-arrows-rotate"></i>';
  } else if (card.value === 'draw2') {
    symbol = '+2';
    centerSymbol = '+2';
  } else if (card.value === 'wild') {
    symbol = '<i class="fa-solid fa-palette"></i>';
    centerSymbol = 'W';
  } else if (card.value === 'draw4') {
    symbol = '+4';
    centerSymbol = '+4';
  }

  cardDiv.innerHTML = `
    <div class="card-top-left">${symbol}</div>
    <div class="card-oval">
      <div class="card-center-val">${centerSymbol}</div>
    </div>
    <div class="card-bottom-right">${symbol}</div>
  `;

  if (onClickHandler) {
    cardDiv.addEventListener('click', onClickHandler);
  }

  return cardDiv;
}

// --- PWA Installation setup ---
let deferredPrompt;
const pwaInstallBanner = document.getElementById('pwa-install-banner');
const pwaInstallBtn = document.getElementById('pwa-install-btn');
const pwaCloseBtn = document.getElementById('pwa-close-btn');

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  if (pwaInstallBanner) {
    pwaInstallBanner.classList.remove('hidden');
  }
});

if (pwaInstallBtn) {
  pwaInstallBtn.addEventListener('click', () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then((choiceResult) => {
      deferredPrompt = null;
      if (pwaInstallBanner) {
        pwaInstallBanner.classList.add('hidden');
      }
    });
  });
}

if (pwaCloseBtn) {
  pwaCloseBtn.addEventListener('click', () => {
    if (pwaInstallBanner) {
      pwaInstallBanner.classList.add('hidden');
    }
  });
}

// Register service worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js')
      .then((reg) => console.log('ServiceWorker registered:', reg.scope))
      .catch((err) => console.log('ServiceWorker registration failed:', err));
  });
}

// Trigger initial connection
initSocketConnection(savedBackendUrl);
