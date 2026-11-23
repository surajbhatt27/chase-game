const express = require("express")
const http = require("http")
const path = require("path")
const { Server } = require("socket.io")
const { Chess } = require("chess.js")

const { randomUUID } = require("crypto")

const requestedPort = Number.parseInt(process.env.PORT ?? "", 10)
const PORT = requestedPort > 0 && requestedPort < 65536 ? requestedPort : 5000

const app = express()
const server = http.createServer(app)
// A closed tab is noticed at once (the client closes its socket on pagehide), so
// the heartbeat only bounds connections that die without a close frame. The
// defaults (25s ping + 20s timeout) leave those stuck on "connected" for up to
// 45s; 20s at worst, while a slow link still gets 10s to answer a ping.
const io = new Server(server, { pingInterval: 10_000, pingTimeout: 10_000 })

const chess = new Chess()

// Seats are owned by a per-tab token so a refresh reclaims the same seat. When
// the owning socket drops, the seat is held ("reserved") for a short grace period.
const seats = { w: null, b: null } // { token, socketId, timer }
const SEAT_GRACE_MS = 30_000
const COLORS = ["w", "b"]

app.set("view engine", "ejs")
app.use(express.static(path.join(__dirname, "public")))

app.get("/", (req, res) => {
    res.render("index", { title: "Chess" })
})

const colorName = (color) => (color === "w" ? "White" : "Black")

// "connected" (someone is sitting there), "reserved" (their socket dropped, seat
// is held for the reclaim window) or "empty".
const seatStatus = (color) =>
    seats[color] ? (seats[color].socketId ? "connected" : "reserved") : "empty"

const seatOf = (socketId) =>
    COLORS.find((color) => seats[color] && seats[color].socketId === socketId) ?? null

const seatByToken = (token) =>
    COLORS.find((color) => seats[color] && seats[color].token === token) ?? null

const freeSeat = () => COLORS.find((color) => !seats[color]) ?? null

function claimSeat(color, socketId, token) {
    clearTimeout(seats[color]?.timer)
    seats[color] = { token, socketId, timer: null }
}

function statusText() {
    if (chess.isCheckmate()) {
        return `Checkmate — ${colorName(chess.turn() === "w" ? "b" : "w")} wins`
    }
    if (chess.isStalemate()) return "Draw by stalemate"
    if (chess.isInsufficientMaterial()) return "Draw by insufficient material"
    if (chess.isThreefoldRepetition()) return "Draw by threefold repetition"
    if (chess.isDraw()) return "Draw"
    if (chess.isCheck()) return `${colorName(chess.turn())} is in check`
    return "Game in progress"
}

// Where the side to move may legally go, keyed by origin square. Sent with every
// state so the browser can show move hints without holding any rules logic.
function legalMovesBySquare() {
    const moves = {}
    for (const { from, to } of chess.moves({ verbose: true })) {
        const destinations = (moves[from] ??= [])
        // The four promotion choices share one destination square.
        if (!destinations.includes(to)) destinations.push(to)
    }
    return moves
}

// Everything the browser needs to draw the game. The client holds no rules logic.
function gameState() {
    return {
        board: chess.board().map((row) =>
            row.map((piece) => (piece ? { type: piece.type, color: piece.color } : null))
        ),
        turn: chess.turn(),
        moves: legalMovesBySquare(),
        history: chess.history({ verbose: true }).map(({ san, color, from, to }) => ({ san, color, from, to })),
        status: statusText(),
        gameOver: chess.isGameOver(),
        seats: { w: seatStatus("w"), b: seatStatus("b") },
    }
}

const broadcastState = () => io.emit("state", gameState())

const SQUARE = /^[a-h][1-8]$/
const PROMOTIONS = ["q", "r", "b", "n"]

// Accept only the fields chess.js needs, so a client can't smuggle extra state in.
function parseMove(raw) {
    if (!raw || typeof raw !== "object") return null
    if (typeof raw.from !== "string" || !SQUARE.test(raw.from)) return null
    if (typeof raw.to !== "string" || !SQUARE.test(raw.to)) return null
    const move = { from: raw.from, to: raw.to }
    if (raw.promotion !== undefined) {
        if (!PROMOTIONS.includes(raw.promotion)) return null
        move.promotion = raw.promotion
    }
    return move
}

io.on("connection", (socket) => {
    const rawToken = socket.handshake.auth ? socket.handshake.auth.token : undefined
    const token = typeof rawToken === "string" && rawToken ? rawToken.slice(0, 128) : randomUUID()

    // Same token as a sitting player (a refresh) keeps that seat; otherwise take
    // whichever seat nobody has claimed.
    const seat = seatByToken(token) ?? freeSeat()
    if (seat) claimSeat(seat, socket.id, token)

    socket.emit("role", seatOf(socket.id))
    broadcastState()

    socket.on("move", (raw) => {
        const seat = seatOf(socket.id)
        if (!seat) return socket.emit("errorMessage", "Spectators can't move pieces")
        if (chess.isGameOver()) return socket.emit("errorMessage", "The game is over — start a new game")
        if (seat !== chess.turn()) return socket.emit("errorMessage", "It's not your turn")

        const move = parseMove(raw)
        if (!move) return socket.emit("invalidMove")

        try {
            chess.move(move)
            broadcastState()
        } catch {
            socket.emit("invalidMove")
        }
    })

    socket.on("reset", () => {
        if (!seatOf(socket.id)) return socket.emit("errorMessage", "Only players can start a new game")
        chess.reset()
        broadcastState()
    })

    socket.on("disconnect", () => {
        const seat = seatOf(socket.id)
        if (!seat) return

        // Hold the seat for the reclaim window, then let it go.
        const entry = seats[seat]
        entry.socketId = null
        entry.timer = setTimeout(() => {
            seats[seat] = null
            broadcastState()
        }, SEAT_GRACE_MS)

        broadcastState()
    })
})

server.listen(PORT, () => {
    console.log(`Chess server listening on http://localhost:${PORT}`)
})
