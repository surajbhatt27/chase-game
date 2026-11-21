const express = require("express")
const http = require("http")
const path = require("path")
const { Server } = require("socket.io")
const { Chess } = require("chess.js")

const requestedPort = Number.parseInt(process.env.PORT ?? "", 10)
const PORT = requestedPort > 0 && requestedPort < 65536 ? requestedPort : 5000

const app = express()
const server = http.createServer(app)
const io = new Server(server)

const chess = new Chess()
const seats = { w: null, b: null }

app.set("view engine", "ejs")
app.use(express.static(path.join(__dirname, "public")))

app.get("/", (req, res) => {
    res.render("index", { title: "Chess" })
})

const colorName = (color) => (color === "w" ? "White" : "Black")
const seatOf = (id) => (seats.w === id ? "w" : seats.b === id ? "b" : null)

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

// Everything the browser needs to draw the game. The client holds no rules logic.
function gameState() {
    return {
        board: chess.board().map((row) =>
            row.map((piece) => (piece ? { type: piece.type, color: piece.color } : null))
        ),
        turn: chess.turn(),
        history: chess.history({ verbose: true }).map(({ san, color, from, to }) => ({ san, color, from, to })),
        status: statusText(),
        gameOver: chess.isGameOver(),
        seats: { w: Boolean(seats.w), b: Boolean(seats.b) },
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
    if (!seats.w) seats.w = socket.id
    else if (!seats.b) seats.b = socket.id

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
        if (seat) seats[seat] = null
        broadcastState()
    })
})

server.listen(PORT, () => {
    console.log(`Chess server listening on http://localhost:${PORT}`)
})
