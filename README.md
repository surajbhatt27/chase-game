This project lets two players compete head-to-head while everyone else joins as spectators.
Moves are validated on the server using Chess.js, ensuring fair play and preventing illegal moves.
The UI supports drag-and-drop pieces, automatic role assignment, board flipping, move history, and smooth live updates for all connected users.

✨ Features

♟️ Real-time gameplay powered by Socket.io

🔐 Server-side move validation with Chess.js

👥 Auto player roles: first join = White, second = Black, others = Spectators

🔄 Instant board sync across all clients

🖱️ Drag & Drop move system

🔁 Board flip toggle (auto-flip for Black + manual override)

📜 Move history tracker

🚫 Illegal move detection with visual feedback

🎨 Clean UI with Tailwind

🔧 Tech Stack

Node.js + Express – backend server

Socket.io – real-time communication

Chess.js – move validation & game rules

EJS – templating

TailwindCSS – styling
