# Repository Guidelines

## Project Structure & Module Organization
- `main.go` and `app.go` host the Go backend and Wails app lifecycle.
- `frontend/` contains the Vite UI; source lives in `frontend/src/` and generated bindings in `frontend/wailsjs/`.
- `frontend/dist/` and `build/` are generated outputs; do not edit them manually.
- Project config and metadata live in `wails.json`, `go.mod`, and `config.json` (defaults/template).

## Build, Test, and Development Commands
- `wails dev`: run the desktop app with live reload (Wails + Vite).
- `wails build`: create a distributable package under `build/`.
- `cd frontend; npm install`: install frontend dependencies.
- `cd frontend; npm run dev`: run the Vite dev server in a browser.
- `cd frontend; npm run build`: build frontend assets into `frontend/dist/`.
- `go test ./...`: run Go tests (once added).

## Coding Style & Naming Conventions
- Go: format with `gofmt` (tabs, standard Go style) and keep package `main` files at repo root.
- JavaScript/CSS: follow the existing style in `frontend/src/` (semicolons, 4-space indentation).
- Naming: Go types `CamelCase`, functions/vars `camelCase`; JS functions `camelCase`.

## Testing Guidelines
- No automated tests are present yet; add Go tests as `*_test.go` near the code they cover.
- For UI changes, smoke-test with `wails dev` and/or `npm run dev`.

## Commit & Pull Request Guidelines
- Current history uses a short, sentence-style subject (e.g., "Initial commit: KindleSend v1.0"). Keep subjects concise and descriptive.
- PRs should include a summary, test steps, and screenshots for UI changes; link related issues when applicable.

## Security & Configuration
- Runtime settings are saved in the user config directory (Windows: `%AppData%\KindleSend\config.json`). Do not commit real credentials.
- If you change defaults, update `defaultConfig` in `app.go` and document required fields.
