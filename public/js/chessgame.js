// Upgraded chessgame.js
const socket = io();
const chess = new Chess();
const boardElement = document.querySelector(".chessboard");
const statusEl = document.getElementById("status");
const myRoleEl = document.getElementById("myRole");
const moveListEl = document.getElementById("moveList");
const turnTextEl = document.getElementById("turnText");
const turnDotEl = document.getElementById("turnDot");
const resetBtn = document.getElementById("resetBtn");
const flipBtn = document.getElementById("flipBtn");

let draggedPiece = null;
let sourceSquare = null;
let playerRole = null;
let manualFlip = false; // user-controlled flip

// Render board and pieces
const renderBoard = (highlightSquares = []) => {
    const board = chess.board();
    boardElement.innerHTML = "";

    board.forEach((row, rowIndex) => {
        row.forEach((col, colIndex) => {
            const squareEl = document.createElement("div");
            squareEl.classList.add("square", (rowIndex + colIndex) % 2 === 0 ? "light" : "dark");
            squareEl.dataset.row = rowIndex;
            squareEl.dataset.col = colIndex;
            const sqName = `${String.fromCharCode(97 + colIndex)}${8 - rowIndex}`;
            if (highlightSquares.includes(sqName)) {
                squareEl.classList.add("highlight");
            }

            if (col) {
                const pieceEl = document.createElement("div");
                pieceEl.classList.add("piece", col.color === "w" ? "white" : "black");
                pieceEl.innerText = getUnicode(col);
                pieceEl.draggable = playerRole === col.color;

                pieceEl.addEventListener("dragstart", (e) => {
                    if (!pieceEl.draggable) { e.preventDefault(); return; }
                    draggedPiece = pieceEl;
                    sourceSquare = { row: rowIndex, col: colIndex };
                    e.dataTransfer.setData("text/plain", "");
                });

                pieceEl.addEventListener("dragend", () => {
                    draggedPiece = null;
                    sourceSquare = null;
                });

                squareEl.appendChild(pieceEl);
            }

            squareEl.addEventListener("dragover", (e) => e.preventDefault());
            squareEl.addEventListener("drop", (e) => {
                e.preventDefault();
                if (!draggedPiece || !sourceSquare) return;
                const target = { row: parseInt(squareEl.dataset.row), col: parseInt(squareEl.dataset.col) };
                handleMove(sourceSquare, target);
            });

            boardElement.appendChild(squareEl);
        });
    });

    // apply flip based on role or manual flip
    if (manualFlip) {
        boardElement.classList.add("flipped");
    } else {
        if (playerRole === "b") boardElement.classList.add("flipped");
        else boardElement.classList.remove("flipped");
    }
};

// emit move to server
const handleMove = (source, target) => {
    const from = `${String.fromCharCode(97 + source.col)}${8 - source.row}`;
    const to = `${String.fromCharCode(97 + target.col)}${8 - target.row}`;
    const candidate = { from, to, promotion: "q" };

    // local sanity check - prevent moving when not your turn
    if ((chess.turn() === "w" && playerRole !== "w") || (chess.turn() === "b" && playerRole !== "b")) {
        flashStatus("Not your turn", true);
        return;
    }

    // send to server - server will validate using chess.js there
    socket.emit("move", candidate);
};

const getUnicode = (p) => {
    const map = { K: "♔", Q: "♕", R: "♖", B: "♗", N: "♘", P: "♙", k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" };
    return map[p.color === "w" ? p.type.toUpperCase() : p.type];
};

// update UI elements like move list and status
const refreshUI = () => {
    // status
    if (chess.in_checkmate()) {
        flashStatus("Checkmate", false);
    } else if (chess.in_draw()) {
        flashStatus("Draw", false);
    } else if (chess.in_check()) {
        flashStatus("Check!", false);
    } else {
        flashStatus("Game in progress", false);
    }

    // turn indicator
    const turn = chess.turn() === "w" ? "White" : "Black";
    turnTextEl.innerText = turn;
    turnDotEl.style.background = chess.turn() === "w" ? "white" : "black";

    // move list
    const history = chess.history({ verbose: true });
    moveListEl.innerHTML = "";
    // Build move pairs
    for (let i = 0; i < history.length; i += 2) {
        const white = history[i] ? history[i].san : "";
        const black = history[i + 1] ? history[i + 1].san : "";
        const row = document.createElement("div");
        row.innerHTML = `<strong>${Math.floor(i / 2) + 1}.</strong>&nbsp; ${white} &nbsp; ${black}`;
        moveListEl.appendChild(row);
    }
};

const flashStatus = (txt, isError = false) => {
    statusEl.innerText = txt;
    statusEl.style.color = isError ? "#ff6b6b" : "#9ae6b4";
    setTimeout(() => {
        statusEl.style.color = "";
    }, 1200);
};

// buttons
resetBtn.addEventListener("click", () => {
    chess.reset();
    socket.emit("boardState", chess.fen()); // inform others (optional: server can handle reset rules)
    renderBoard();
    refreshUI();
});

flipBtn.addEventListener("click", () => {
    manualFlip = !manualFlip;
    renderBoard();
});

// socket handlers
socket.on("playerRole", (role) => {
    playerRole = role;
    myRoleEl.innerText = role === "w" ? "White" : "Black";
    renderBoard();
    refreshUI();
});

socket.on("spectatorRole", () => {
    playerRole = null;
    myRoleEl.innerText = "Spectator";
    renderBoard();
    refreshUI();
});

socket.on("boardState", (fen) => {
    chess.load(fen);
    renderBoard();
    refreshUI();
});

socket.on("move", (move) => {
    chess.move(move);
    renderBoard();
    refreshUI();
});

// in case server sends invalid move event name variations (be tolerant)
socket.on("InvalidMove", (mv) => { flashStatus("Invalid move", true); });
socket.on("invalidMove", (mv) => { flashStatus("Invalid move", true); });

// initial render
renderBoard();
refreshUI();