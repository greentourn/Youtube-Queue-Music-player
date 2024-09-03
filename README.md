
# YouTube Music Queue Player

![image](https://github.com/user-attachments/assets/b829be41-16d4-4f23-885d-655796a38151)

This project is a real-time YouTube music queue player that allows users to add YouTube links to a queue, view the current playing song, and manage the queue collaboratively. The server ensures that all connected users see and control the same queue of songs. This project is built using Node.js, Socket.io, and the YouTube Data API.

## Features

- **Real-time Song Queue:** Add YouTube songs to the queue and view the current playing song in real-time across all connected users.
- **Queue Management:** Users can add, remove, and reorder songs in the queue.
- **Synchronized Playback:** The playback is synchronized for all users connected to the website.
- **YouTube Data API Integration:** Fetch song details (e.g., title, thumbnail) using the YouTube Data API.
- **Socket.io Integration:** Real-time communication for queue updates and playback control.

## Getting Started

### Prerequisites

- Node.js
- A YouTube Data API Key

### Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/yourusername/yourrepository.git
   cd yourrepository
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Set up environment variables:

   Create a `.env` file in the root directory and add your YouTube API key:

   ```
   YOUTUBE_API_KEY=your_youtube_api_key
   ```

4. Run the server:

   ```bash
   node server.js
   ```

5. Visit `http://localhost:3000` in your browser.

### Deployment

To deploy the project on Vercel:

1. Connect your GitHub repository to Vercel.
2. Ensure that your environment variables are correctly set up on Vercel.
3. Deploy the project directly from your Vercel dashboard.

### Troubleshooting

- Ensure that the YouTube Data API key is valid and has the correct permissions.
- If you encounter socket-related errors, verify that Socket.io is correctly initialized and that the server is running properly.

## License

This project is licensed under the MIT License.
