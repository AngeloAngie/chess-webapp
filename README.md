# Chess

A full-featured chess web app — no build step, no framework, just HTML/CSS/JS.

## Features

- Full chess rules: legal moves, castling, en passant, promotion, check/checkmate/stalemate
- Two Player (local), vs Computer (minimax AI with adjustable difficulty), and Online multiplayer
- Online play via Firebase (Firestore-synced games, invite links — no account required to play as a guest)
- Leermodus (learn mode): move-quality feedback with plain-language explanations
- Sound effects, animated pieces, 3 visual themes, fullscreen game view
- Saved preferences (theme/sound/learn mode) via localStorage

## Running locally

No build step — just serve the folder statically, e.g.:

```
python -m http.server 8765
```

Then open `http://localhost:8765`.

## Firestore security rules

See [firestore.rules](firestore.rules) — paste into Firebase Console → Firestore Database → Rules.
