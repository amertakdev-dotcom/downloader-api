# Amertak Network - Multi-Platform Downloader API

> No API Key required for any platform. Self-hosted Node.js API.

## Supported Platforms
- ✅ YouTube (video + audio formats, thumbnail)
- ✅ TikTok (video no watermark, images/slideshow, audio)
- ✅ Pinterest (image HD, video, multi-image)
- ✅ Spotify (track info, thumbnail, download link, 30s preview)

## Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/youtube?url=` | YouTube video info + download |
| GET | `/api/tiktok?url=` | TikTok video/image info + download |
| GET | `/api/pinterest?url=` | Pinterest pin info + download |
| GET | `/api/spotify?url=` | Spotify track/album info + download |
| GET | `/api/info?url=` | Auto-detect platform |
| GET | `/api/detect?url=` | Only detect platform |
| GET | `/health` | Health check |

## Auth (Optional)
Set `API_SECRET_KEY` in `.env`. Then pass header:
```
x-api-key: YOUR_SECRET_KEY
```

## Setup
```bash
npm install
cp .env.example .env
npm start
```

## Deploy to Render
See setup guide in Khmer below or follow render.yaml config.
