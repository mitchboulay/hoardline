# MediaFlow

Self-hosted web UI for yt-dlp — implemented from the Claude Design mock
(`MediaFlow.dc.html`, project "Document design requirements"). Frontend only:
all data is mocked, download progress is simulated. Ready for backend
integration.

```sh
npm install
npm run dev    # http://localhost:5173
npm test       # job state-machine tests
npm run build
```

Stack: Vite + React + TypeScript, react-router, zustand. Theme (dark/light)
and accent color persist to localStorage.
