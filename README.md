# Dudee Music Queue

A real-time collaborative music queue player with AI assistant integration, built using Node.js, Socket.IO, and YouTube API.

![Demo Screenshot](https://github.com/user-attachments/assets/b829be41-16d4-4f23-885d-655796a38151)

## Features

- **Real-time Collaborative Queue**: Multiple users can add, remove, and reorder songs simultaneously
- **AI Music Assistant**: Integrated chat interface for music recommendations and playback control
- **Discord Bot Integration**: Control music playback and queue through Discord commands
- **Synchronized Playback**: All users see the same playback state and queue in real-time
- **Multi-Platform Support**: Access through web browser or Discord
- **Smart Search**: Natural language processing for music search and recommendations
- **Playlist Support**: Import songs from YouTube playlists
- **Queue Management**: 
  - Add/remove songs
  - Reorder queue items
  - Skip current song
  - Clear queue
  - Play specific songs immediately

## Architecture

### Frontend
- HTML5 with Bootstrap 5.3
- Socket.IO client for real-time communication
- YouTube IFrame Player API
- Custom CSS animations and responsive design

### Backend
- Node.js with Express
- Socket.IO for real-time events
- Discord.js for bot integration
- Google's Generative AI for natural language processing
- YouTube Data API v3 integration

### Services
- `QueueService`: Manages the song queue
- `SocketService`: Handles real-time communication
- `StateService`: Manages playback state
- `YouTubeService`: Handles YouTube API interactions
- `ChatAI`: Processes natural language commands
- `DiscordBot`: Manages Discord integration

## Prerequisites

- Node.js 18 or higher
- YouTube Data API key
- Discord Bot Token (for Discord integration)
- Gemini API key (for AI features)

## Environment Variables

Create a `.env` file in the root directory:

```
YOUTUBE_API_KEY=your_youtube_api_key
DISCORD_TOKEN=your_discord_bot_token
GEMINI_API_KEY=your_gemini_api_key
WEBAPP_URL=your_webapp_url
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

4. Visit `http://localhost:3000` in your browser

## Discord Bot Commands

- `!search` or `!หา`: Search for songs
- `!skip`: Skip current song
- `!queue`: Show current queue
- `!clear`: Clear the queue
- Natural language commands through AI assistant

## Development

### Project Structure
```
Project/
├── public/
│   ├── index.html      # Main web interface
│   ├── script.js       # Client-side JavaScript
│   └── styles.css      # CSS styles
├── ChatBot/
│   ├── chatAI.js      # AI assistant logic
│   └── discord-bot.js  # Discord bot implementation
├── services/
│   ├── queueService.js    # Queue management
│   ├── socketService.js   # WebSocket handling
│   ├── stateService.js    # Playback state
│   └── youtubeService.js  # YouTube API integration
├── server.js          # Main server file
└── package.json       # Project dependencies
```

### API Documentation

#### Socket Events
- `updatePlaybackState`: Update current playback state
- `queueUpdated`: Notify queue changes
- `chat message`: Process chat messages
- `search results`: Return search results
- `playlistFound`: Handle playlist detection

#### HTTP Endpoints
- `GET /server-time`: Get server timestamp
- `GET /youtube-info/:videoId`: Get video details
- `GET /current-state`: Get current playback state

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Version History

- 0.8.2: Added AI chat features and improved synchronization
- 0.8.1: Added Discord bot integration
- 0.8.0: Initial release with basic functionality