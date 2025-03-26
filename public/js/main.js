import { initializeSocket } from './services/socketService-client.js';
import { initializePlayer } from './components/player.js';
import { initializeQueue } from './components/queue.js';
import { initializeChat } from './components/chat.js';
import { syncWithServer, shouldResync } from './services/uiService.js';

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

async function initializeApp() {
  // ซิงค์เวลากับเซิร์ฟเวอร์ก่อนที่จะเริ่มต้นใช้งานแอพพลิเคชั่น
  await syncWithServer();

  // Initialize services และส่วนประกอบอื่นๆ หลังจากที่ซิงค์เวลาเรียบร้อยแล้ว
  const socket = initializeSocket();
  
  // Initialize components
  initializePlayer(socket);
  initializeQueue(socket);
  initializeChat(socket);
  
  // ดึงข้อมูลเวอร์ชั่น
  initializeVersion();
  
  // ตั้งค่าให้มีการตรวจสอบการซิงค์เวลาเมื่อกลับมาที่แท็บ
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && shouldResync()) {
      syncWithServer();
    }
  });
}

document.addEventListener('DOMContentLoaded', initializeApp);