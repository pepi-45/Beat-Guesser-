# Beat Guesser 🎵

Multiplayer party game: one host plays YouTube snippets through host speakers; guests guess from phones.

## Local run

```bash
npm install
npm start
```

Open http://localhost:3000.

## Render deployment

1. Upload `server.js`, `package.json`, `public/`, `.gitignore`, and this README to the root of your GitHub repository.
2. Render → New → Web Service → connect repository.
3. Runtime: Node; Build Command: `npm install`; Start Command: `npm start`.
4. Share the public Render URL. Everyone can join from different networks.

## Notes

- Rooms and scores are stored in memory and reset when Render restarts or sleeps.
- YouTube embedding restrictions may prevent accurate 0.5-second snippets or playback of certain videos; audio runs only in the host's browser.
- The host must keep the page open and have speakers connected. Some browsers require clicking the video once to allow playback.
- Autocomplete uses the public iTunes Search API; a song might not be listed there. Guests can also type a title and artist manually.
- Guesses match title and artist normalized for capitalization and punctuation. Enter host song metadata carefully.
- No paid Spotify integration is required.
