# WWE Predictions Tracker

A self-hosted WWE event predictions tracker built for Synology NAS via Docker.

## Features
- User name-based accounts (persistent via localStorage)
- Admin panel to set up matches (1v1 up to 8-way)
- Cutoff time lock — no changes after event starts
- Live scoreboard grid with ✓/✗ results
- Wrestler avatar initials with color coding
- Fully offline-capable (no external services needed)

## Quick Start (Docker Compose)

```bash
# 1. Copy this folder to your NAS
# 2. Edit docker-compose.yml and set a real ADMIN_PASSWORD
# 3. Run:
docker compose up -d
```

Access the site at `http://your-nas-ip:3000`

## Configuration (docker-compose.yml)

| Variable | Default | Description |
|----------|---------|-------------|
| `ADMIN_PASSWORD` | `wrestlemania` | **Change this!** Admin login password |
| `SESSION_SECRET` | random string | Secret for session cookies — change this |
| `PORT` | `3000` | Port to run on |

## Data Storage

All data is saved to `./data/data.json` on the host. Back this up to preserve predictions.

## Admin Usage

1. Click **Admin** in the top right corner
2. Log in with your admin password
3. Go to **Admin Panel** tab
4. Set the event name + cutoff time
5. Add matches with wrestler names
6. After each match concludes, select the winner from the dropdown
7. The scoreboard updates automatically for everyone

## User Flow

1. Visit the site → click **Sign In** or the name badge
2. Enter your name (same name = same account)
3. Click each match card to select your predicted winner
4. View the **Scoreboard** tab to see how everyone is doing
