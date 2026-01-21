// One to Ten - Client Application
const socket = io();

// State
let state = {
  roomCode: null,
  sessionId: null,
  playerRole: null, // 'player1' | 'player2' | 'spectator'
  selectedNumber: null,
  salt: null,
  numberHash: null,
  maxNumber: 10
};

// Session management
function saveSession() {
  if (state.roomCode && state.sessionId) {
    localStorage.setItem('oneToTen_session', JSON.stringify({
      roomCode: state.roomCode,
      sessionId: state.sessionId,
      playerRole: state.playerRole,
      salt: state.salt,
      selectedNumber: state.selectedNumber
    }));
  }
}

function loadSession() {
  const saved = localStorage.getItem('oneToTen_session');
  return saved ? JSON.parse(saved) : null;
}

function clearSession() {
  localStorage.removeItem('oneToTen_session');
}

// Views
const views = {
  landing: document.getElementById('view-landing'),
  lobby: document.getElementById('view-lobby'),
  waiting: document.getElementById('view-waiting'),
  join: document.getElementById('view-join'),
  waitingResult: document.getElementById('view-waiting-result'),
  result: document.getElementById('view-result'),
  history: document.getElementById('view-history'),
  browse: document.getElementById('view-browse')
};

// Elements
const elements = {
  // Landing
  btnCreate: document.getElementById('btn-create'),
  btnJoin: document.getElementById('btn-join'),
  inputRoomCode: document.getElementById('input-room-code'),
  btnHistory: document.getElementById('btn-history'),

  // Lobby (Player 1)
  displayRoomCode: document.getElementById('display-room-code'),
  btnCopyCode: document.getElementById('btn-copy-code'),
  btnCopyLink: document.getElementById('btn-copy-link'),
  inputP1Name: document.getElementById('input-p1-name'),
  inputChallenge: document.getElementById('input-challenge'),
  inputMaxNumber: document.getElementById('input-max-number'),
  numberPickerP1: document.getElementById('number-picker-p1'),
  btnSubmitChallenge: document.getElementById('btn-submit-challenge'),
  statusLobby: document.getElementById('status-lobby'),

  // Waiting
  displayChallenge: document.getElementById('display-challenge'),
  statusP2Name: document.getElementById('status-p2-name'),
  displayRoomCodeWaiting: document.getElementById('display-room-code-waiting'),
  btnCopyCodeWaiting: document.getElementById('btn-copy-code-waiting'),
  btnCopyLinkWaiting: document.getElementById('btn-copy-link-waiting'),

  // Join (Player 2)
  inputP2Name: document.getElementById('input-p2-name'),
  challengeSection: document.getElementById('challenge-section'),
  displayP1Name: document.getElementById('display-p1-name'),
  displayChallengeP2: document.getElementById('display-challenge-p2'),
  displayMaxNumber: document.getElementById('display-max-number'),
  numberPickerP2: document.getElementById('number-picker-p2'),
  btnSubmitGuess: document.getElementById('btn-submit-guess'),
  waitingForChallenge: document.getElementById('waiting-for-challenge'),

  // Result
  resultTitle: document.getElementById('result-title'),
  resultP1Label: document.getElementById('result-p1-label'),
  resultP2Label: document.getElementById('result-p2-label'),
  resultP1Number: document.getElementById('result-p1-number'),
  resultP2Number: document.getElementById('result-p2-number'),
  resultChallenge: document.getElementById('result-challenge'),
  resultHash: document.getElementById('result-hash'),
  verificationStatus: document.getElementById('verification-status'),
  btnPlayAgain: document.getElementById('btn-play-again'),

  // History
  historyList: document.getElementById('history-list'),
  btnBackHistory: document.getElementById('btn-back-history'),

  // Browse
  btnBrowse: document.getElementById('btn-browse'),
  roomsList: document.getElementById('rooms-list'),
  btnBackBrowse: document.getElementById('btn-back-browse'),

  // Error overlay
  overlayError: document.getElementById('overlay-error'),
  errorTitle: document.getElementById('error-title'),
  errorMessage: document.getElementById('error-message'),
  btnErrorOk: document.getElementById('btn-error-ok')
};

// Crypto functions
async function generateSalt() {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
}

async function hashCommitment(number, salt) {
  const message = `${number}:${salt}`;
  const encoder = new TextEncoder();
  const data = encoder.encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function verifyCommitment(number, salt, expectedHash) {
  const actualHash = await hashCommitment(number, salt);
  return actualHash === expectedHash;
}

// View management
function showView(viewName) {
  Object.values(views).forEach(v => v.classList.add('hidden'));
  views[viewName].classList.remove('hidden');
}

function showError(title, message) {
  elements.errorTitle.textContent = title;
  elements.errorMessage.textContent = message;
  elements.overlayError.classList.remove('hidden');
}

// Number picker
function createNumberPicker(container, maxNumber, onSelect) {
  container.innerHTML = '';
  for (let i = 1; i <= maxNumber; i++) {
    const btn = document.createElement('button');
    btn.className = 'number-btn';
    btn.textContent = i;
    btn.addEventListener('click', () => {
      container.querySelectorAll('.number-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      onSelect(i);
    });
    container.appendChild(btn);
  }
}

// Validate Player 1 form
function validateP1Form() {
  const hasName = elements.inputP1Name.value.trim().length > 0;
  const hasChallenge = elements.inputChallenge.value.trim().length > 0;
  const hasNumber = state.selectedNumber !== null;
  elements.btnSubmitChallenge.disabled = !(hasName && hasChallenge && hasNumber);
}

// Check for room code in URL
function checkUrlForRoom() {
  const params = new URLSearchParams(window.location.search);
  const roomCode = params.get('room');
  if (roomCode) {
    elements.inputRoomCode.value = roomCode;
    joinRoom(roomCode);
  }
}

// Create room
function createRoom() {
  socket.emit('create-room', (response) => {
    if (response.success) {
      state.roomCode = response.roomCode;
      state.sessionId = response.sessionId;
      state.playerRole = 'player1';
      saveSession();
      elements.displayRoomCode.textContent = response.roomCode;

      // Create number picker
      const maxNum = parseInt(elements.inputMaxNumber.value) || 10;
      state.maxNumber = maxNum;
      state.selectedNumber = null; // Reset selected number
      createNumberPicker(elements.numberPickerP1, maxNum, (num) => {
        state.selectedNumber = num;
        validateP1Form();
      });

      showView('lobby');
      validateP1Form(); // Ensure button is disabled initially
    } else {
      showError('Error', response.error);
    }
  });
}

// Join room
function joinRoom(code) {
  const roomCode = code || elements.inputRoomCode.value.trim();
  if (!roomCode) {
    showError('Error', 'Please enter a room code');
    return;
  }

  socket.emit('join-room', roomCode, (response) => {
    if (response.success) {
      state.roomCode = response.roomCode;
      state.playerRole = response.role;
      state.maxNumber = response.maxNumber || 10;

      // Spectator mode
      if (response.role === 'spectator') {
        if (response.result) {
          showResult(response.result);
        } else if (response.state === 'challenge_set') {
          // Show waiting view for spectators
          elements.displayChallenge.textContent = response.challenge;
          elements.displayRoomCodeWaiting.textContent = state.roomCode;
          showView('waiting');
        } else {
          showView('waitingResult');
        }
        return;
      }

      // Player 2
      state.sessionId = response.sessionId;
      saveSession();

      showView('join');

      if (response.hasChallenge) {
        showChallenge(response.challenge, response.maxNumber, response.player1Name);
      }
    } else {
      showError('Error', response.error);
    }
  });
}

// Rejoin room with saved session
function rejoinRoom(session) {
  socket.emit('rejoin-room', {
    roomCode: session.roomCode,
    sessionId: session.sessionId
  }, (response) => {
    if (response.success) {
      state.roomCode = session.roomCode;
      state.sessionId = session.sessionId;
      state.playerRole = response.role;
      state.salt = session.salt;
      state.selectedNumber = session.selectedNumber;

      // If game is completed, show result
      if (response.result) {
        showResult(response.result);
        return;
      }

      // Restore appropriate view based on state
      if (response.role === 'player1') {
        if (response.state === 'waiting') {
          elements.displayRoomCode.textContent = state.roomCode;
          showView('lobby');
        } else if (response.state === 'challenge_set') {
          elements.displayChallenge.textContent = response.challenge;
          elements.displayRoomCodeWaiting.textContent = state.roomCode;
          showView('waiting');
        }
      } else if (response.role === 'player2') {
        if (response.state === 'challenge_set') {
          showChallenge(response.challenge, response.maxNumber, response.player1Name);
          showView('join');
        }
      }
    } else {
      // Session invalid, clear and show landing
      clearSession();
      checkUrlForRoom();
    }
  });
}

// Show challenge to Player 2
function showChallenge(challenge, maxNumber, player1Name) {
  elements.displayP1Name.textContent = player1Name || 'Player 1';
  elements.displayChallengeP2.textContent = challenge;
  elements.displayMaxNumber.textContent = maxNumber;
  state.maxNumber = maxNumber;

  createNumberPicker(elements.numberPickerP2, maxNumber, (num) => {
    state.selectedNumber = num;
    elements.btnSubmitGuess.disabled = elements.inputP2Name.value.trim().length === 0;
  });

  elements.waitingForChallenge.classList.add('hidden');
  elements.challengeSection.classList.remove('hidden');
}

// Submit challenge (Player 1)
async function submitChallenge() {
  const name = elements.inputP1Name.value.trim();
  const challenge = elements.inputChallenge.value.trim();
  const maxNumber = parseInt(elements.inputMaxNumber.value) || 10;

  // Validate all fields
  if (!name || !challenge || state.selectedNumber === null) {
    showError('Error', 'Please fill in your name, challenge, and pick a number');
    return;
  }

  // Generate commitment
  state.salt = await generateSalt();
  state.numberHash = await hashCommitment(state.selectedNumber, state.salt);
  saveSession(); // Save salt for potential rejoin

  socket.emit('set-name', name, () => {});
  socket.emit('submit-challenge', {
    challenge,
    maxNumber,
    numberHash: state.numberHash
  }, (response) => {
    if (response.success) {
      elements.displayChallenge.textContent = challenge;
      elements.displayRoomCodeWaiting.textContent = state.roomCode;
      showView('waiting');
    } else {
      showError('Error', response.error);
    }
  });
}

// Submit guess (Player 2)
function submitGuess() {
  const name = elements.inputP2Name.value.trim();

  socket.emit('set-name', name, () => {});
  socket.emit('submit-guess', { number: state.selectedNumber }, (response) => {
    if (response.success) {
      showView('waitingResult');
    } else {
      showError('Error', response.error);
    }
  });
}

// Show result
async function showResult(result) {
  const matched = result.matched;
  const resultView = views.result;

  // Set classes for styling
  resultView.classList.remove('result-match', 'result-no-match');
  resultView.classList.add(matched ? 'result-match' : 'result-no-match');

  // Title
  if (matched) {
    elements.resultTitle.textContent = 'MATCH!';
    elements.resultTitle.style.background = '#ff6b9d';
  } else {
    elements.resultTitle.textContent = 'NO MATCH';
    elements.resultTitle.style.background = '#00d4ff';
  }

  // Names and numbers
  elements.resultP1Label.textContent = result.player1Name || 'Player 1';
  elements.resultP2Label.textContent = result.player2Name || 'Player 2';
  elements.resultP1Number.textContent = result.player1Number;
  elements.resultP2Number.textContent = result.player2Number;

  // Challenge
  elements.resultChallenge.textContent = result.challenge;

  // Verification
  elements.resultHash.textContent = result.numberHash.substring(0, 16) + '...';

  const isValid = await verifyCommitment(result.player1Number, result.salt, result.numberHash);
  elements.verificationStatus.textContent = isValid ? '✓ Verified - No cheating detected' : '✗ Verification failed!';
  elements.verificationStatus.className = 'verification-status ' + (isValid ? 'valid' : 'invalid');

  showView('result');
}

// Load history
async function loadHistory() {
  try {
    const response = await fetch('/api/history');
    const games = await response.json();

    elements.historyList.innerHTML = '';

    if (games.length === 0) {
      elements.historyList.innerHTML = '<p class="status">No games played yet</p>';
    } else {
      games.forEach(game => {
        const item = document.createElement('div');
        item.className = 'history-item ' + (game.matched ? 'match' : 'no-match');
        item.innerHTML = `
          <div class="history-challenge">"${escapeHtml(game.challenge)}"</div>
          <div class="history-players">${escapeHtml(game.player1_name)} vs ${escapeHtml(game.player2_name)}</div>
          <div class="history-result">
            Numbers: ${game.player1_number} vs ${game.player2_number} -
            ${game.matched ? '<strong>MATCH!</strong>' : 'No match'}
          </div>
        `;
        elements.historyList.appendChild(item);
      });
    }

    showView('history');
  } catch (err) {
    showError('Error', 'Failed to load history');
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Load active rooms
async function loadRooms() {
  try {
    const response = await fetch('/api/rooms');
    const rooms = await response.json();

    elements.roomsList.innerHTML = '';

    if (rooms.length === 0) {
      elements.roomsList.innerHTML = '<p class="status">No active rooms waiting for players</p>';
    } else {
      rooms.forEach(room => {
        const item = document.createElement('div');
        item.className = 'history-item';
        item.style.cursor = 'pointer';
        item.innerHTML = `
          <div class="history-challenge">"${escapeHtml(room.challenge)}"</div>
          <div class="history-players">by ${escapeHtml(room.player1Name)} (1-${room.maxNumber})</div>
          <div class="history-result">Click to join</div>
        `;
        item.addEventListener('click', () => {
          joinRoom(room.roomCode);
        });
        elements.roomsList.appendChild(item);
      });
    }

    showView('browse');
  } catch (err) {
    showError('Error', 'Failed to load rooms');
  }
}

// Event listeners
elements.btnCreate.addEventListener('click', createRoom);
elements.btnJoin.addEventListener('click', () => joinRoom());
elements.inputRoomCode.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') joinRoom();
});

elements.btnCopyCode.addEventListener('click', () => {
  navigator.clipboard.writeText(state.roomCode);
  elements.btnCopyCode.textContent = 'Copied!';
  setTimeout(() => elements.btnCopyCode.textContent = 'Copy Code', 2000);
});

elements.btnCopyLink.addEventListener('click', () => {
  const link = `${window.location.origin}?room=${state.roomCode}`;
  navigator.clipboard.writeText(link);
  elements.btnCopyLink.textContent = 'Copied!';
  setTimeout(() => elements.btnCopyLink.textContent = 'Copy Link', 2000);
});

elements.btnCopyCodeWaiting.addEventListener('click', () => {
  navigator.clipboard.writeText(state.roomCode);
  elements.btnCopyCodeWaiting.textContent = 'Copied!';
  setTimeout(() => elements.btnCopyCodeWaiting.textContent = 'Copy Code', 2000);
});

elements.btnCopyLinkWaiting.addEventListener('click', () => {
  const link = `${window.location.origin}?room=${state.roomCode}`;
  navigator.clipboard.writeText(link);
  elements.btnCopyLinkWaiting.textContent = 'Copied!';
  setTimeout(() => elements.btnCopyLinkWaiting.textContent = 'Copy Link', 2000);
});

elements.inputP1Name.addEventListener('input', validateP1Form);
elements.inputChallenge.addEventListener('input', validateP1Form);
elements.inputMaxNumber.addEventListener('change', () => {
  const maxNum = parseInt(elements.inputMaxNumber.value) || 10;
  state.maxNumber = maxNum;
  state.selectedNumber = null;
  createNumberPicker(elements.numberPickerP1, maxNum, (num) => {
    state.selectedNumber = num;
    validateP1Form();
  });
  validateP1Form();
});

elements.btnSubmitChallenge.addEventListener('click', submitChallenge);

elements.inputP2Name.addEventListener('input', () => {
  elements.btnSubmitGuess.disabled =
    elements.inputP2Name.value.trim().length === 0 || state.selectedNumber === null;
});

elements.btnSubmitGuess.addEventListener('click', submitGuess);

elements.btnPlayAgain.addEventListener('click', () => {
  clearSession();
  state = { roomCode: null, sessionId: null, playerRole: null, selectedNumber: null, salt: null, numberHash: null, maxNumber: 10 };
  window.history.replaceState({}, '', window.location.pathname);
  showView('landing');
});

elements.btnHistory.addEventListener('click', loadHistory);
elements.btnBackHistory.addEventListener('click', () => showView('landing'));

elements.btnBrowse.addEventListener('click', loadRooms);
elements.btnBackBrowse.addEventListener('click', () => showView('landing'));

elements.btnErrorOk.addEventListener('click', () => {
  elements.overlayError.classList.add('hidden');
});

// Socket events
socket.on('player-joined', () => {
  elements.statusLobby.textContent = 'A player joined the room!';
});

socket.on('player2-named', (name) => {
  elements.statusP2Name.textContent = `${name} is guessing...`;
});

socket.on('challenge-ready', ({ challenge, maxNumber, player1Name }) => {
  showChallenge(challenge, maxNumber, player1Name);
});

socket.on('guess-submitted', ({ player2Name }) => {
  // Player 1 reveals their number
  socket.emit('reveal-number', {
    number: state.selectedNumber,
    salt: state.salt
  }, (response) => {
    if (response.success) {
      showResult(response.result);
    } else {
      showError('Error', response.error);
    }
  });
});

socket.on('game-result', (result) => {
  showResult(result);
});

socket.on('opponent-disconnected', () => {
  showError('Disconnected', 'Your opponent has disconnected.');
});

socket.on('connect_error', () => {
  showError('Connection Error', 'Unable to connect to server.');
});

// Rejoin on reconnect if we have a session
socket.on('connect', () => {
  if (state.sessionId && state.roomCode) {
    // Re-establish session after reconnect
    socket.emit('rejoin-room', {
      roomCode: state.roomCode,
      sessionId: state.sessionId
    }, (response) => {
      if (!response.success) {
        console.log('Failed to rejoin after reconnect:', response.error);
      }
    });
  }
});

// Initialize
function init() {
  const params = new URLSearchParams(window.location.search);
  const urlRoomCode = params.get('room');
  const savedSession = loadSession();

  // If URL has a different room code, join that room (as spectator/player2)
  if (urlRoomCode && (!savedSession || savedSession.roomCode !== urlRoomCode.toUpperCase())) {
    joinRoom(urlRoomCode);
    return;
  }

  // Rejoin saved session if exists
  if (savedSession) {
    rejoinRoom(savedSession);
    return;
  }

  // Check for room code in URL (same as saved session)
  if (urlRoomCode) {
    joinRoom(urlRoomCode);
  }
}

init();
