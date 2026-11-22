// A per-tab token that survives refresh (sessionStorage) lets the server give this
// browser its seat back after a reload. A brand new tab gets its own token.
const TOKEN_KEY = "chessPlayerToken";

const playerToken = sessionStorage.getItem(TOKEN_KEY) || (() => {
    const token = typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `t${Date.now()}${Math.random().toString(36).slice(2)}`;
    sessionStorage.setItem(TOKEN_KEY, token);
    return token;
})();

const socket = io({ auth: { token: playerToken } });

const boardElement = document.querySelector(".chessboard");
const statusEl = document.getElementById("status");
const myRoleEl = document.getElementById("myRole");
const moveListEl = document.getElementById("moveList");
const turnTextEl = document.getElementById("turnText");
const turnDotEl = document.getElementById("turnDot");
const resetBtn = document.getElementById("resetBtn");
const flipBtn = document.getElementById("flipBtn");
const seatLineEl = document.getElementById("seatLine");
const promotionEl = document.getElementById("promotion");
const promotionButtons = promotionEl.querySelectorAll("button[data-piece]");

const GLYPHS = {
    w: { k: "♔", q: "♕", r: "♖", b: "♗", n: "♘", p: "♙" },
    b: { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" },
};
const COLOR_NAMES = { w: "White", b: "Black" };

// state is whatever the server last sent: board, turn, history, status, seats.
let state = null;
let playerRole = null;
let manualFlip = false;
let statusColorTimer = null;
let pendingPromotion = null;
// Square picked up by tap/click, waiting for its destination square.
let selectedSquare = null;

const squareName = (row, col) => `${String.fromCharCode(97 + col)}${8 - row}`;

const pieceAt = (square) => {
    if (!state) return null;
    const col = square.charCodeAt(0) - 97;
    const row = 8 - Number(square[1]);
    return state.board[row] ? state.board[row][col] : null;
};

const flashStatus = (text, isError = false) => {
    statusEl.textContent = text;
    statusEl.style.color = isError ? "#ff6b6b" : "#9ae6b4";
    clearTimeout(statusColorTimer);
    statusColorTimer = setTimeout(() => {
        statusEl.style.color = "";
        if (state) renderMeta();
    }, 2000);
};

const renderBoard = () => {
    // A selection only survives while that piece is still this player's to move.
    if (selectedSquare) {
        const selected = pieceAt(selectedSquare);
        if (!selected || selected.color !== playerRole || state.turn !== playerRole || state.gameOver) {
            selectedSquare = null;
        }
    }

    const lastMove = state.history.length ? state.history[state.history.length - 1] : null;
    boardElement.innerHTML = "";

    state.board.forEach((row, rowIndex) => {
        row.forEach((piece, colIndex) => {
            const name = squareName(rowIndex, colIndex);
            const squareEl = document.createElement("div");
            squareEl.className = `square ${(rowIndex + colIndex) % 2 === 0 ? "light" : "dark"}`;

            if (lastMove && (lastMove.from === name || lastMove.to === name)) {
                squareEl.classList.add("last-move");
            }

            if (name === selectedSquare) squareEl.classList.add("selected");

            const canMove = piece && playerRole === piece.color && playerRole === state.turn && !state.gameOver;

            if (piece) {
                const pieceEl = document.createElement("div");
                pieceEl.className = `piece ${piece.color === "w" ? "white" : "black"}`;
                pieceEl.textContent = GLYPHS[piece.color][piece.type];
                pieceEl.draggable = canMove;

                if (canMove) {
                    pieceEl.addEventListener("dragstart", (event) => {
                        // A drag supersedes any tap selection, so its highlight
                        // can't be left behind pointing at the wrong piece.
                        clearSelection();
                        event.dataTransfer.setData("text/plain", name);
                        event.dataTransfer.effectAllowed = "move";
                    });
                }

                squareEl.appendChild(pieceEl);
            }

            squareEl.addEventListener("dragover", (event) => {
                if (playerRole) event.preventDefault();
            });

            squareEl.addEventListener("drop", (event) => {
                event.preventDefault();
                const from = event.dataTransfer.getData("text/plain");
                if (from) requestMove(from, name);
            });

            // Tap/click to move. Touch screens never fire the drag events above,
            // so this is the only way to play on a phone.
            squareEl.addEventListener("click", () => onSquareClick(name));

            boardElement.appendChild(squareEl);
        });
    });

    const shouldFlip = manualFlip || playerRole === "b";
    boardElement.classList.toggle("flipped", shouldFlip);
};

const renderMeta = () => {
    const waitingFor = ["w", "b"].find((color) => state.seats[color] === "empty");
    statusEl.textContent = waitingFor ? `Waiting for ${COLOR_NAMES[waitingFor]} to join — ${state.status}` : state.status;

    const turnName = state.gameOver ? "—" : COLOR_NAMES[state.turn];
    turnTextEl.textContent = turnName;
    turnDotEl.style.background = state.gameOver ? "transparent" : state.turn === "w" ? "white" : "black";

    myRoleEl.textContent = playerRole ? COLOR_NAMES[playerRole] : "Spectator";
    seatLineEl.textContent = `White: ${state.seats.w} · Black: ${state.seats.b}`;
    resetBtn.disabled = !playerRole;
};

const renderHistory = () => {
    moveListEl.innerHTML = "";
    for (let i = 0; i < state.history.length; i += 2) {
        const white = state.history[i] ? state.history[i].san : "";
        const black = state.history[i + 1] ? state.history[i + 1].san : "";
        const row = document.createElement("div");
        row.innerHTML = `<strong>${i / 2 + 1}.</strong>&nbsp; ${white} &nbsp; ${black}`;
        moveListEl.appendChild(row);
    }
    moveListEl.scrollTop = moveListEl.scrollHeight;
};

const render = () => {
    if (!state) return;
    renderBoard();
    renderMeta();
    renderHistory();
};

const requestMove = (from, to) => {
    if (!playerRole) return flashStatus("Spectators can't move pieces", true);
    if (state.gameOver) return flashStatus("The game is over — start a new game", true);
    if (state.turn !== playerRole) return flashStatus("It's not your turn", true);

    const piece = pieceAt(from);
    if (!piece || piece.color !== playerRole) return;

    const promotes = piece.type === "p" && ((piece.color === "w" && to[1] === "8") || (piece.color === "b" && to[1] === "1"));
    if (promotes) {
        pendingPromotion = { from, to };
        promotionEl.classList.remove("hidden");
        if (piece.color === "b") promotionEl.classList.add("black-to-move");
        return;
    }

    socket.emit("move", { from, to });
};

// Drop the tap selection and its highlight without rebuilding the board: a
// dragstart that re-rendered would pull the dragged piece out from under the
// browser and cancel the drag.
const clearSelection = () => {
    selectedSquare = null;
    const highlighted = boardElement.querySelector(".square.selected");
    if (highlighted) highlighted.classList.remove("selected");
};

const onSquareClick = (square) => {
    // Squares only exist once a state has been rendered, so there is always a state.
    if (selectedSquare) {
        if (square === selectedSquare) return clearSelection();

        // Tapping another of your own pieces moves the selection rather than
        // trying to capture your own piece.
        const piece = pieceAt(square);
        if (piece && piece.color === playerRole) {
            selectedSquare = square;
            return renderBoard();
        }

        const from = selectedSquare;
        clearSelection();
        return requestMove(from, square);
    }

    const piece = pieceAt(square);
    if (!piece || piece.color !== playerRole) return;
    if (state.gameOver) return flashStatus("The game is over — start a new game", true);
    if (state.turn !== playerRole) return flashStatus("It's not your turn", true);

    selectedSquare = square;
    renderBoard();
};

const closePromotion = () => {
    pendingPromotion = null;
    promotionEl.classList.add("hidden");
};

promotionButtons.forEach((button) => {
    button.addEventListener("click", () => {
        if (!pendingPromotion) return;
        socket.emit("move", { ...pendingPromotion, promotion: button.dataset.piece });
        closePromotion();
    });
});

promotionEl.addEventListener("click", (event) => {
    if (event.target === promotionEl) closePromotion();
});

document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closePromotion();
});

resetBtn.addEventListener("click", () => {
    clearSelection();
    closePromotion();
    socket.emit("reset");
});

flipBtn.addEventListener("click", () => {
    if (!state) return;
    const currentlyFlipped = manualFlip || playerRole === "b";
    manualFlip = !currentlyFlipped;
    renderBoard();
});

socket.on("role", (role) => {
    playerRole = role;
    render();
});

socket.on("state", (nextState) => {
    state = nextState;
    if (state.gameOver) closePromotion();
    render();
});

socket.on("invalidMove", () => flashStatus("Illegal move", true));
socket.on("errorMessage", (message) => flashStatus(message, true));

// Leaving the page — closing the tab, navigating away, or entering the
// back/forward cache — closes the socket straight away, so the seat turns
// "reserved" immediately instead of waiting for the heartbeat.
window.addEventListener("pagehide", () => socket.disconnect());

// Whenever the page is shown again (including back/forward-cache restores) the
// socket may have been closed above; reopen it and the server gives this tab's
// seat back to its token. connect() is a no-op when already connected.
window.addEventListener("pageshow", () => {
    if (!socket.connected) socket.connect();
});

socket.on("disconnect", () => {
    statusEl.textContent = "Connection lost — reconnecting…";
    statusEl.style.color = "#ff6b6b";
});

socket.on("connect", () => {
    statusEl.style.color = "";
    render();
});
