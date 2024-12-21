import { initializeSocket } from './services/socketService.js';
import { initializePlayer } from './components/player.js';
import { initializeQueue } from './components/queue.js';
import { initializeChat } from './components/chat.js';
import { syncWithServer } from './services/uiService.js';

async function initializeVersion() {
  try {
    const response = await fetch('/version');
    const { version } = await response.json();
    const versionElement = document.querySelector('#version');
    if (versionElement) {
      versionElement.textContent = `Version ${version}`;
    }
  } catch (error) {
    console.error('Error fetching version:', error);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  // Initialize services
  const socket = initializeSocket();
  await syncWithServer();

  // Initialize components
  initializePlayer(socket);
  initializeQueue(socket);
  initializeChat(socket);
});