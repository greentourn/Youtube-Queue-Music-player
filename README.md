# Dudee Music Queue

A real-time collaborative music player web application with AI assistant integration and Discord bot support.

## Features

- 🎵 YouTube video playback with synchronized playback state across all clients
- 💬 AI-powered music assistant for natural language song requests and controls
- 🤖 Discord bot integration for remote music control
- 📱 Responsive web interface with queue management
- 🔄 Real-time updates using Socket.IO
- 🔍 YouTube search integration
- 🤝 Multi-user support with concurrent playback synchronization
- 🎮 Advanced playback controls (play, pause, skip, etc.)
- 📋 Playlist support

## Technology Stack

- **Frontend**:
  - HTML5/CSS3
  - JavaScript (ES6+)
  - Socket.IO Client
  - YouTube IFrame API
  - Bootstrap 5

- **Backend**:
  - Node.js
  - Express.js
  - Socket.IO
  - Discord.js
  - Google Generative AI (Gemini)

- **APIs**:
  - YouTube Data API v3
  - Discord API

## Prerequisites

- Node.js (v16+)
- YouTube API Key
- Discord Bot Token
- Gemini API Key
- MongoDB (optional)

## Environment Variables

Create a `.env` file with the following:

```env
YOUTUBE_API_KEY=your_youtube_api_key
DISCORD_TOKEN=your_discord_bot_token
GEMINI_API_KEY=your_gemini_api_key
WEBAPP_URL=http://localhost:3000
```

## Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/dudee-music-queue.git
cd dudee-music-queue
```

2. Install dependencies:
```bash
npm install
```

3. Start the server:
```bash
npm start
```

## Project Structure

### Frontend Components

- **Player (`components/player.js`)**: YouTube player integration with sync support
- **Queue (`components/queue.js`)**: Music queue management interface
- **Chat (`components/chat.js`)**: AI assistant chat interface

### Backend Services

- **Queue Service**: Manages the music queue
- **State Service**: Handles playback state synchronization
- **Socket Service**: Real-time communication
- **YouTube Service**: YouTube API integration with fallback
- **Chat AI**: Gemini-powered music assistant
- **Discord Bot**: Discord integration for remote control

## API Endpoints

- `GET /version`: Get application version
- `GET /server-time`: Get server timestamp
- `GET /youtube-info/:videoId`: Get video details
- `GET /current-state`: Get current playback state

## WebSocket Events

### Client → Server
- `addSong`: Add song to queue
- `skipSong`: Skip current song
- `removeSong`: Remove song from queue
- `updatePlaybackState`: Update playback state
- `chat message`: Send message to AI assistant

### Server → Client
- `queueUpdated`: Queue update notification
- `playbackState`: Playback state update
- `chat response`: AI assistant response
- `search results`: YouTube search results

## AI Assistant Commands

The AI assistant understands natural language commands for:
- Music search and playback
- Queue management
- Playback control
- Music recommendations
- General music-related queries

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit changes
4. Push to branch
5. Create Pull Request

## License

ISC

