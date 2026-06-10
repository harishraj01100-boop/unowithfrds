const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Global state for rooms
const rooms = {};

// Helper: Generate a unique room code
function generateRoomCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// Helper: Create standard UNO deck of 108 cards
function createDeck() {
  const colors = ['red', 'blue', 'green', 'yellow'];
  const deck = [];
  let cardIdCounter = 1;

  colors.forEach(color => {
    // 1. One '0' card per color
    deck.push({ id: `card_${cardIdCounter++}`, color, value: '0' });

    // 2. Two of each '1'-'9' card per color
    for (let num = 1; num <= 9; num++) {
      deck.push({ id: `card_${cardIdCounter++}`, color, value: num.toString() });
      deck.push({ id: `card_${cardIdCounter++}`, color, value: num.toString() });
    }

    // 3. Two of each action card: Skip, Reverse, Draw 2
    deck.push({ id: `card_${cardIdCounter++}`, color, value: 'skip' });
    deck.push({ id: `card_${cardIdCounter++}`, color, value: 'skip' });

    deck.push({ id: `card_${cardIdCounter++}`, color, value: 'reverse' });
    deck.push({ id: `card_${cardIdCounter++}`, color, value: 'reverse' });

    deck.push({ id: `card_${cardIdCounter++}`, color, value: 'draw2' });
    deck.push({ id: `card_${cardIdCounter++}`, color, value: 'draw2' });
  });

  // 4. Four Wild cards & four Wild Draw 4 cards
  for (let i = 0; i < 4; i++) {
    deck.push({ id: `card_${cardIdCounter++}`, color: 'wild', value: 'wild' });
    deck.push({ id: `card_${cardIdCounter++}`, color: 'wild', value: 'draw4' });
  }

  return deck;
}

// Helper: Shuffle deck (Fisher-Yates algorithm)
function shuffle(deck) {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// Helper: Draw cards from deck, reshuffling discard pile if empty
function drawCardFromDeck(room, count = 1) {
  const drawn = [];
  for (let i = 0; i < count; i++) {
    if (room.deck.length === 0) {
      if (room.discardPile.length <= 1) {
        // No cards left to draw or shuffle
        break;
      }
      const topCard = room.discardPile.pop();
      room.deck = shuffle(room.discardPile);
      // Reset color of wildcard objects to 'wild' for reuse
      room.deck.forEach(card => {
        if (card.value === 'wild' || card.value === 'draw4') {
          card.color = 'wild';
        }
      });
      room.discardPile = [topCard];
    }
    if (room.deck.length > 0) {
      drawn.push(room.deck.pop());
    }
  }
  return drawn;
}

// Helper: Get next turn index by stepping through active players
function getNextTurnIndex(room, offset = 1) {
  const numPlayers = room.players.length;
  let currentIndex = room.turnIndex;

  // Step 'offset' times through active players
  for (let step = 0; step < offset; step++) {
    let found = false;
    // Search one-by-one in the direction to find the next active player
    for (let i = 0; i < numPlayers; i++) {
      currentIndex = (currentIndex + room.direction + numPlayers) % numPlayers;
      if (room.players[currentIndex].hand.length > 0) {
        found = true;
        break; // found the next active player for this step
      }
    }
    if (!found) {
      return room.turnIndex; // Default fallback if no active player
    }
  }
  return currentIndex;
}

// Helper: Check if the game is finished
function checkGameFinished(room) {
  const activePlayersRemaining = room.players.filter(p => p.hand.length > 0);
  if (activePlayersRemaining.length <= 1) {
    if (activePlayersRemaining.length === 1) {
      const lastPlayer = activePlayersRemaining[0];
      if (!room.winnerRankings.includes(lastPlayer.name)) {
        room.winnerRankings.push(lastPlayer.name);
      }
    }
    room.gameFinished = true;
    return true;
  }
  return false;
}

// Helper: Safely serialize game state for a specific client (hiding other players' hands)
function sanitizeGameState(room, socketId) {
  return {
    roomCode: room.roomCode,
    gameStarted: room.gameStarted,
    gameFinished: room.gameFinished,
    turnIndex: room.turnIndex,
    direction: room.direction,
    currentSelectedColor: room.currentSelectedColor,
    discardPile: room.discardPile.slice(-1), // only top card is visible
    deckCount: room.deck.length,
    winnerRankings: room.winnerRankings,
    hasDrawnThisTurn: room.hasDrawnThisTurn,
    pendingChallenge: room.pendingChallenge ? {
      playedById: room.pendingChallenge.playedById,
      playedByName: room.pendingChallenge.playedByName,
      targetId: room.pendingChallenge.targetId,
      targetName: room.pendingChallenge.targetName,
      wildColor: room.pendingChallenge.wildColor
    } : null,
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      isHost: p.isHost,
      cardCount: p.hand.length,
      unoDeclared: p.unoDeclared,
      // Only include actual cards for the player who owns them
      hand: p.id === socketId ? p.hand : []
    }))
  };
}

// Helper: Send sanitized game state to all players in the room
function broadcastGameState(room) {
  room.players.forEach(player => {
    io.to(player.id).emit('gameStateUpdate', sanitizeGameState(room, player.id));
  });
}

// Socket.IO Connections
io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  // Track room and name of this connection
  let currentRoomCode = null;
  let currentUserName = null;

  // 1. Create Room
  socket.on('createRoom', (playerName) => {
    const name = playerName.trim() || 'Host';
    const roomCode = generateRoomCode();
    
    rooms[roomCode] = {
      roomCode,
      players: [
        {
          id: socket.id,
          name: name,
          hand: [],
          isHost: true,
          unoDeclared: false
        }
      ],
      deck: [],
      discardPile: [],
      gameStarted: false,
      gameFinished: false,
      turnIndex: 0,
      direction: 1, // 1 = clockwise, -1 = counter-clockwise
      winnerRankings: [],
      currentSelectedColor: null,
      hasDrawnThisTurn: false // tracks if active player has drawn a card this turn
    };

    currentRoomCode = roomCode;
    currentUserName = name;
    socket.join(roomCode);
    
    socket.emit('roomCreated', roomCode);
    
    const room = rooms[roomCode];
    broadcastGameState(room);
    
    // Server log message to chat
    io.to(roomCode).emit('chatMessage', {
      sender: 'System',
      text: `${name} created room ${roomCode}.`,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });
  });

  // 2. Join Room
  socket.on('joinRoom', ({ roomCode, playerName }) => {
    const code = roomCode.trim().toUpperCase();
    const name = playerName.trim() || `Player_${socket.id.substring(0, 4)}`;

    const room = rooms[code];
    if (!room) {
      return socket.emit('errorMsg', 'Room not found.');
    }
    if (room.gameStarted) {
      return socket.emit('errorMsg', 'This game has already started.');
    }
    if (room.players.length >= 10) {
      return socket.emit('errorMsg', 'Room is full (max 10 players).');
    }

    // Add player to room state
    room.players.push({
      id: socket.id,
      name: name,
      hand: [],
      isHost: false,
      unoDeclared: false
    });

    currentRoomCode = code;
    currentUserName = name;
    socket.join(code);

    socket.emit('roomJoined', code);
    broadcastGameState(room);

    io.to(code).emit('chatMessage', {
      sender: 'System',
      text: `${name} joined the room.`,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });
  });

  // 3. Send Chat Message
  socket.on('sendMessage', (text) => {
    if (!currentRoomCode || !currentUserName) return;
    io.to(currentRoomCode).emit('chatMessage', {
      sender: currentUserName,
      text: text.trim(),
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });
  });

  // 4. Start Game
  socket.on('startGame', () => {
    const room = rooms[currentRoomCode];
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player || !player.isHost) {
      return socket.emit('errorMsg', 'Only the host can start the game.');
    }
    if (room.players.length < 2) {
      return socket.emit('errorMsg', 'Need at least 2 players to start the game.');
    }

    // Initialize Deck
    room.deck = shuffle(createDeck());
    room.discardPile = [];
    room.winnerRankings = [];
    room.gameStarted = true;
    room.gameFinished = false;
    room.turnIndex = 0;
    room.direction = 1;
    room.hasDrawnThisTurn = false;

    // Deal 7 cards to each player
    room.players.forEach(p => {
      p.hand = drawCardFromDeck(room, 7);
      p.unoDeclared = false;
    });

    // Draw starting card (cannot be Wild Draw 4)
    let startCard = null;
    let attempts = 0;
    while (attempts < 10) {
      const drawn = drawCardFromDeck(room, 1)[0];
      if (drawn.value === 'draw4') {
        // Put back and reshuffle
        room.deck.push(drawn);
        room.deck = shuffle(room.deck);
        attempts++;
      } else {
        startCard = drawn;
        break;
      }
    }
    // Fallback if we somehow drew draw4 multiple times
    if (!startCard) {
      startCard = room.deck.find(c => c.value !== 'draw4');
      room.deck = room.deck.filter(c => c.id !== startCard.id);
    }

    room.discardPile.push(startCard);
    
    // Set active color
    if (startCard.color === 'wild') {
      // Pick random starting color for wild card
      const colors = ['red', 'blue', 'green', 'yellow'];
      room.currentSelectedColor = colors[Math.floor(Math.random() * colors.length)];
    } else {
      room.currentSelectedColor = startCard.color;
    }

    // Handle initial special card effects
    if (startCard.value === 'skip') {
      room.turnIndex = getNextTurnIndex(room, 1);
    } else if (startCard.value === 'reverse') {
      room.direction = -1;
      // In 2 player, reverse acts like skip, but turnIndex handles it:
      if (room.players.length === 2) {
        room.turnIndex = getNextTurnIndex(room, 1);
      } else {
        // For >2 players, reverse starting means host starts, but flow is CCW.
        // We stay at index 0 (host).
        room.turnIndex = 0;
      }
    } else if (startCard.value === 'draw2') {
      // First player draws 2 cards and skips turn
      const firstPlayer = room.players[room.turnIndex];
      firstPlayer.hand.push(...drawCardFromDeck(room, 2));
      room.turnIndex = getNextTurnIndex(room, 1);
    }

    broadcastGameState(room);

    io.to(currentRoomCode).emit('chatMessage', {
      sender: 'System',
      text: `Game has started! Top card is ${startCard.color.toUpperCase()} ${startCard.value.toUpperCase()}.`,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });
  });

  // 5. Draw Card
  socket.on('drawCard', () => {
    const room = rooms[currentRoomCode];
    if (!room || !room.gameStarted || room.gameFinished) return;

    const activePlayer = room.players[room.turnIndex];
    if (activePlayer.id !== socket.id) {
      return socket.emit('errorMsg', "It's not your turn.");
    }
    if (room.hasDrawnThisTurn) {
      return socket.emit('errorMsg', "You have already drawn a card this turn.");
    }

    const drawnCards = drawCardFromDeck(room, 1);
    if (drawnCards.length > 0) {
      const drawnCard = drawnCards[0];
      activePlayer.hand.push(drawnCard);
      activePlayer.unoDeclared = false; // Reset UNO status when drawing
      
      const topCard = room.discardPile[room.discardPile.length - 1];
      const isPlayable = (
        drawnCard.color === 'wild' ||
        drawnCard.color === room.currentSelectedColor ||
        drawnCard.value.toString() === topCard.value.toString()
      );

      let systemText = "";

      if (isPlayable) {
        // Playable: Keep turn, allow player to play it or pass
        room.hasDrawnThisTurn = true;
        systemText = `${activePlayer.name} drew a card. It is playable, so they can play it or pass.`;
      } else {
        // Not playable: Turn automatically passes to next player
        room.hasDrawnThisTurn = false;
        systemText = `${activePlayer.name} drew a card (not playable). Turn passes to the next player.`;
        room.turnIndex = getNextTurnIndex(room, 1);
      }
      
      broadcastGameState(room);
      
      socket.emit('cardDrawnAlert', drawnCard);

      io.to(currentRoomCode).emit('chatMessage', {
        sender: 'System',
        text: systemText,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      });
    } else {
      socket.emit('errorMsg', "No cards left in the deck.");
    }
  });

  // 6. Play Card
  socket.on('playCard', ({ cardId, wildColor }) => {
    const room = rooms[currentRoomCode];
    if (!room || !room.gameStarted || room.gameFinished) return;

    const activePlayer = room.players[room.turnIndex];
    if (activePlayer.id !== socket.id) {
      return socket.emit('errorMsg', "It's not your turn.");
    }

    const cardIndex = activePlayer.hand.findIndex(c => c.id === cardId);
    if (cardIndex === -1) {
      return socket.emit('errorMsg', "Card not found in your hand.");
    }

    const card = activePlayer.hand[cardIndex];
    const topCard = room.discardPile[room.discardPile.length - 1];

    // Validate if the card is playable
    const isWild = (card.color === 'wild');
    const colorMatches = (card.color === room.currentSelectedColor);
    const valueMatches = (card.value.toString() === topCard.value.toString());

    if (!isWild && !colorMatches && !valueMatches) {
      return socket.emit('errorMsg', "Invalid card! Must match current color or value/type.");
    }

    // If card is wild, ensure selected color is valid
    if (isWild && !['red', 'blue', 'green', 'yellow'].includes(wildColor)) {
      return socket.emit('errorMsg', "Please select a valid color (Red, Blue, Green, Yellow) for the Wild card.");
    }

    // Wild Draw Four restriction and challenge setup
    if (card.value === 'draw4') {
      const activeColorBeforePlay = room.currentSelectedColor;
      const wasIllegal = activePlayer.hand.some(c => c.color === activeColorBeforePlay);

      // Play card: Remove from hand, put in discard pile
      activePlayer.hand.splice(cardIndex, 1);
      card.color = wildColor; // Keep track of chosen color in discard pile representation
      room.discardPile.push(card);
      room.currentSelectedColor = wildColor;
      room.hasDrawnThisTurn = false;

      // Set challenge state
      const targetPlayerIndex = getNextTurnIndex(room, 1);
      const targetPlayer = room.players[targetPlayerIndex];

      room.pendingChallenge = {
        playedById: activePlayer.id,
        playedByName: activePlayer.name,
        targetId: targetPlayer.id,
        targetName: targetPlayer.name,
        wasIllegal: wasIllegal,
        wildColor: wildColor,
        prevSelectedColor: activeColorBeforePlay
      };

      broadcastGameState(room);

      io.to(currentRoomCode).emit('chatMessage', {
        sender: 'System',
        text: `${activePlayer.name} played WILD DRAW FOUR choosing ${wildColor.toUpperCase()}. Waiting for ${targetPlayer.name} to Accept or Challenge!`,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      });

      return;
    }

    // Play card: Remove from hand, put in discard pile
    activePlayer.hand.splice(cardIndex, 1);
    room.discardPile.push(card);

    // Apply color update
    if (isWild) {
      card.color = wildColor; // Keep track of chosen color in discard pile representation
      room.currentSelectedColor = wildColor;
    } else {
      room.currentSelectedColor = card.color;
    }

    let nextTurnOffset = 1;
    let drawCountForNext = 0;
    let systemText = `${activePlayer.name} played ${card.color.toUpperCase()} ${card.value.toUpperCase()}.`;

    // Reset drawn status
    room.hasDrawnThisTurn = false;

    // Apply special card effects
    if (card.value === 'skip') {
      nextTurnOffset = 2; // skip the next player
      systemText += ` Next player's turn is skipped.`;
    } else if (card.value === 'reverse') {
      room.direction *= -1; // reverse rotation direction
      systemText += ` Play direction reversed.`;
      // In a 2-active-player game, reverse acts exactly like skip
      const activePlayersCount = room.players.filter(p => p.hand.length > 0).length;
      if (activePlayersCount === 2) {
        nextTurnOffset = 2;
      }
    } else if (card.value === 'draw2') {
      drawCountForNext = 2;
      nextTurnOffset = 2; // draw 2 also skips the target's turn
      systemText += ` Next player draws 2 cards and skips their turn.`;
    }

    // Check if current player has finished
    const hasFinished = (activePlayer.hand.length === 0);
    if (hasFinished) {
      if (!room.winnerRankings.includes(activePlayer.name)) {
        room.winnerRankings.push(activePlayer.name);
        systemText += ` 🏆 ${activePlayer.name} has finished all their cards!`;
      }
    }

    // Apply drawing penalty to the next player if needed (only for draw2)
    if (drawCountForNext > 0) {
      const targetPlayerIndex = getNextTurnIndex(room, 1);
      const targetPlayer = room.players[targetPlayerIndex];
      const drawn = drawCardFromDeck(room, drawCountForNext);
      targetPlayer.hand.push(...drawn);
      targetPlayer.unoDeclared = false; // reset their UNO status
    }

    // Check if game is completely finished
    checkGameFinished(room);

    // Determine the next player's index
    if (!room.gameFinished) {
      room.turnIndex = getNextTurnIndex(room, nextTurnOffset);
    }

    broadcastGameState(room);

    io.to(currentRoomCode).emit('chatMessage', {
      sender: 'System',
      text: systemText,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });

    if (room.gameFinished) {
      io.to(currentRoomCode).emit('gameOver', room.winnerRankings);
    }
  });

  // 6b. Accept Draw 4
  socket.on('acceptDraw4', () => {
    const room = rooms[currentRoomCode];
    if (!room || !room.gameStarted || room.gameFinished || !room.pendingChallenge) return;

    const challenge = room.pendingChallenge;
    if (challenge.targetId !== socket.id) {
      return socket.emit('errorMsg', "Only the target player can accept.");
    }

    const targetPlayer = room.players.find(p => p.id === challenge.targetId);
    const playedByPlayer = room.players.find(p => p.id === challenge.playedById);
    if (!targetPlayer || !playedByPlayer) return;

    // Target draws 4 cards
    const drawn = drawCardFromDeck(room, 4);
    targetPlayer.hand.push(...drawn);
    targetPlayer.unoDeclared = false;

    // Clear challenge
    room.pendingChallenge = null;

    let systemText = `${targetPlayer.name} accepted the WILD DRAW FOUR, drew 4 cards, and missed their turn.`;

    // Check if playedByPlayer finished
    if (playedByPlayer.hand.length === 0) {
      if (!room.winnerRankings.includes(playedByPlayer.name)) {
        room.winnerRankings.push(playedByPlayer.name);
        systemText += ` 🏆 ${playedByPlayer.name} has finished all their cards!`;
      }
    }

    // Check if game is finished
    checkGameFinished(room);

    if (!room.gameFinished) {
      // Advance turn by 2 (skip target)
      room.turnIndex = getNextTurnIndex(room, 2);
    }

    broadcastGameState(room);

    io.to(currentRoomCode).emit('chatMessage', {
      sender: 'System',
      text: systemText,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });

    if (room.gameFinished) {
      io.to(currentRoomCode).emit('gameOver', room.winnerRankings);
    }
  });

  // 6c. Challenge Draw 4
  socket.on('challengeDraw4', () => {
    const room = rooms[currentRoomCode];
    if (!room || !room.gameStarted || room.gameFinished || !room.pendingChallenge) return;

    const challenge = room.pendingChallenge;
    if (challenge.targetId !== socket.id) {
      return socket.emit('errorMsg', "Only the target player can challenge.");
    }

    const targetPlayer = room.players.find(p => p.id === challenge.targetId);
    const playedByPlayer = room.players.find(p => p.id === challenge.playedById);
    if (!targetPlayer || !playedByPlayer) return;

    const wasIllegal = challenge.wasIllegal;
    room.pendingChallenge = null;

    let systemText = "";
    let nextTurnOffset = 1;

    if (wasIllegal) {
      // Challenge Successful! PlayedBy draws 4 penalty cards. Target draws 0 and plays their turn.
      const drawn = drawCardFromDeck(room, 4);
      playedByPlayer.hand.push(...drawn);
      playedByPlayer.unoDeclared = false;

      systemText = `🎯 Challenge SUCCESSFUL! ${playedByPlayer.name} played Wild Draw Four illegally (had active color ${challenge.prevSelectedColor.toUpperCase()}). ${playedByPlayer.name} draws 4 cards!`;

      // Target player is not skipped, plays their turn.
      nextTurnOffset = 1;
    } else {
      // Challenge Failed! Target draws 6 cards (4 + 2 penalty) and is skipped.
      const drawn = drawCardFromDeck(room, 6);
      targetPlayer.hand.push(...drawn);
      targetPlayer.unoDeclared = false;

      systemText = `❌ Challenge FAILED! ${playedByPlayer.name} played Wild Draw Four legally. ${targetPlayer.name} draws 6 cards (4 + 2 penalty) and misses their turn!`;

      // Target player is skipped.
      nextTurnOffset = 2;
    }

    // Check if playedByPlayer finished
    if (playedByPlayer.hand.length === 0) {
      if (!room.winnerRankings.includes(playedByPlayer.name)) {
        room.winnerRankings.push(playedByPlayer.name);
        systemText += ` 🏆 ${playedByPlayer.name} has finished all their cards!`;
      }
    }

    // Check if game is finished
    checkGameFinished(room);

    if (!room.gameFinished) {
      room.turnIndex = getNextTurnIndex(room, nextTurnOffset);
    }

    broadcastGameState(room);

    io.to(currentRoomCode).emit('chatMessage', {
      sender: 'System',
      text: systemText,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });

    if (room.gameFinished) {
      io.to(currentRoomCode).emit('gameOver', room.winnerRankings);
    }
  });

  // 7. Pass Turn (only active after drawing)
  socket.on('passTurn', () => {
    const room = rooms[currentRoomCode];
    if (!room || !room.gameStarted || room.gameFinished) return;

    const activePlayer = room.players[room.turnIndex];
    if (activePlayer.id !== socket.id) {
      return socket.emit('errorMsg', "It's not your turn.");
    }
    if (!room.hasDrawnThisTurn) {
      return socket.emit('errorMsg', "You must draw a card before passing.");
    }

    room.hasDrawnThisTurn = false;
    room.turnIndex = getNextTurnIndex(room, 1);

    broadcastGameState(room);

    io.to(currentRoomCode).emit('chatMessage', {
      sender: 'System',
      text: `${activePlayer.name} passed their turn.`,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });
  });

  // 8. Declare UNO
  socket.on('declareUno', () => {
    const room = rooms[currentRoomCode];
    if (!room || !room.gameStarted) return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    // Toggle UNO declaration
    player.unoDeclared = !player.unoDeclared;
    broadcastGameState(room);

    const statusMsg = player.unoDeclared ? 'declared UNO!' : 'retracted UNO declaration.';
    io.to(currentRoomCode).emit('chatMessage', {
      sender: 'System',
      text: `${player.name} has ${statusMsg}`,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });
  });

  // 9. Catch UNO (Callout)
  socket.on('catchUno', (targetPlayerId) => {
    const room = rooms[currentRoomCode];
    if (!room || !room.gameStarted || room.gameFinished) return;

    const targetPlayer = room.players.find(p => p.id === targetPlayerId);
    const reportingPlayer = room.players.find(p => p.id === socket.id);

    if (!targetPlayer || !reportingPlayer) return;

    // A player can only be caught if they have exactly 1 card and have not declared UNO
    if (targetPlayer.hand.length === 1 && !targetPlayer.unoDeclared) {
      const drawn = drawCardFromDeck(room, 2);
      targetPlayer.hand.push(...drawn);
      targetPlayer.unoDeclared = false; // explicitly clear it

      broadcastGameState(room);

      io.to(currentRoomCode).emit('chatMessage', {
        sender: 'System',
        text: `🎯 ${reportingPlayer.name} caught ${targetPlayer.name} not declaring UNO! ${targetPlayer.name} draws 2 cards as penalty!`,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      });
    } else {
      socket.emit('errorMsg', `${targetPlayer.name} is safe (either has declared UNO or doesn't have exactly 1 card).`);
    }
  });

  // 10. Restart Game / Reset room to lobby
  socket.on('restartGame', () => {
    const room = rooms[currentRoomCode];
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player || !player.isHost) {
      return socket.emit('errorMsg', 'Only the host can restart the game.');
    }

    room.gameStarted = false;
    room.gameFinished = false;
    room.winnerRankings = [];
    room.players.forEach(p => {
      p.hand = [];
      p.unoDeclared = false;
    });
    room.deck = [];
    room.discardPile = [];
    room.currentSelectedColor = null;

    broadcastGameState(room);

    io.to(currentRoomCode).emit('chatMessage', {
      sender: 'System',
      text: `Host has returned the game to the lobby. Ready to start a new game!`,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });
  });

  // 11. Disconnect
  socket.on('disconnect', () => {
    console.log(`Socket disconnected: ${socket.id}`);
    if (currentRoomCode && rooms[currentRoomCode]) {
      const room = rooms[currentRoomCode];
      const playerIndex = room.players.findIndex(p => p.id === socket.id);

      if (playerIndex !== -1) {
        const playerName = room.players[playerIndex].name;
        const wasHost = room.players[playerIndex].isHost;
        const leftHand = room.players[playerIndex].hand;

        // Remove from players list
        room.players.splice(playerIndex, 1);

        // If a pending challenge involves the disconnecting player, clear it
        if (room.pendingChallenge && (room.pendingChallenge.playedById === socket.id || room.pendingChallenge.targetId === socket.id)) {
          room.pendingChallenge = null;
        }

        // Put left hand cards back into deck so we don't lose cards
        if (leftHand.length > 0) {
          // Clean cards if they were wildcards and had selected colors
          leftHand.forEach(c => {
            if (c.value === 'wild' || c.value === 'draw4') {
              c.color = 'wild';
            }
          });
          room.deck.push(...leftHand);
          room.deck = shuffle(room.deck);
        }

        io.to(currentRoomCode).emit('chatMessage', {
          sender: 'System',
          text: `${playerName} disconnected.`,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        });

        // If no players left, clean up the entire room
        if (room.players.length === 0) {
          delete rooms[currentRoomCode];
        } else {
          // Assign a new host if needed
          if (wasHost && room.players.length > 0) {
            room.players[0].isHost = true;
            io.to(currentRoomCode).emit('chatMessage', {
              sender: 'System',
              text: `${room.players[0].name} is now the host.`,
              time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            });
          }

          // If game was running, check turns
          if (room.gameStarted && !room.gameFinished) {
            // Adjust turnIndex if it exceeded the new length
            if (room.turnIndex >= room.players.length) {
              room.turnIndex = 0;
            }

            // Check if game is now finished due to lack of players
            const activePlayersRemaining = room.players.filter(p => p.hand.length > 0);
            if (activePlayersRemaining.length <= 1) {
              if (activePlayersRemaining.length === 1) {
                const lastPlayer = activePlayersRemaining[0];
                if (!room.winnerRankings.includes(lastPlayer.name)) {
                  room.winnerRankings.push(lastPlayer.name);
                }
              }
              room.gameFinished = true;
              io.to(currentRoomCode).emit('gameOver', room.winnerRankings);
            }
          }

          broadcastGameState(room);
        }
      }
    }
  });
});

// Start Express + HTTP Server
server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
