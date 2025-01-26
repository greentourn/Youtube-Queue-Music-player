# Music Queue Web Application v0.8.8

A real-time collaborative music queue web application with YouTube integration, chat AI assistant, and Discord bot support.

## Features

- Real-time music playback synchronization across multiple clients
- YouTube video integration with search and playlist support
- AI-powered chat assistant for music recommendations and playback control
- Discord bot integration
- Fault-tolerant queue management
- State synchronization with server
- Fallback service for YouTube API quota management

## Prerequisites

- Node.js (v14+)
- Discord Bot Token
- YouTube API Key
- Gemini API Key

## Installation

1. Clone the repository
2. Install dependencies:
```bash
npm install
```

3. Create `.env` file with the following variables:
```
YOUTUBE_API_KEY=your_youtube_api_key
DISCORD_TOKEN=your_discord_bot_token
GEMINI_API_KEY=your_gemini_api_key
WEBAPP_URL=http://localhost:3000
```

## Running the Application

Start the server:
```bash
npm start
```

The application will be available at `http://localhost:3000`

## Architecture

### Frontend Components
- `player.js`: YouTube player integration and state management
- `queue.js`: Music queue interface and management
- `chat.js`: AI chat interface and interactions

### Backend Services
- `queueService.js`: Queue state management
- `stateService.js`: Playback state synchronization
- `youtubeService-server.js`: YouTube API integration
- `socketService-server.js`: Real-time communication
- `chatAI.js`: AI chat processing

### Features

#### Music Playback
- Synchronized playback across all clients
- Real-time state updates
- Auto-recovery from connection issues
- Playlist support

#### Chat AI Assistant
- Natural language song requests
- Playback control through chat
- Music recommendations
- Context-aware responses

#### Discord Bot
- Music playback control
- Queue management
- AI chat integration
- Search functionality

## API Keys

Required API keys:
- YouTube Data API v3
- Discord Bot Token
- Gemini AI API

## Error Handling

The application includes:
- YouTube API quota management
- Fallback service for API failures
- Connection recovery
- State synchronization
- Error logging

## Version History

Current Version: 0.8.8
- AI chat improvements
- Enhanced state synchronization
- YouTube fallback service
- Improved error handling
- Discord bot integration

## License

ISC License
