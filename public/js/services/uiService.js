// services/uiService.js
import { createElementWithClasses, appendChildren } from '../utils/helpers.js';

let timeOffset = 0;
let lastSyncTime = 0;
let syncRetries = 0;
const MAX_SYNC_RETRIES = 3;
const SYNC_INTERVAL = 60000; // 1 minute
const RETRY_INTERVAL = 5000; // 5 seconds

export async function syncWithServer() {
  const startTime = Date.now();
  try {
    const response = await fetch('/server-time');
    const { serverTime } = await response.json();
    const endTime = Date.now();
    const networkDelay = (endTime - startTime) / 2;

    // คำนวณ offset ระหว่าง client/server
    timeOffset = serverTime - (startTime + networkDelay);
    lastSyncTime = Date.now();
    syncRetries = 0;

    // ตั้งเวลาให้มีการซิงค์กับเซิร์ฟเวอร์ทุก 1 นาที
    setTimeout(syncWithServer, SYNC_INTERVAL);
    
    console.log(`Time synchronized with server. Offset: ${timeOffset}ms`);
    return timeOffset;
  } catch (error) {
    console.error('Time sync failed:', error);
    syncRetries++;
    
    // ถ้าการซิงค์ล้มเหลว ให้ลองใหม่ไม่เกิน MAX_SYNC_RETRIES ครั้งโดยรอทุก 5 วินาที
    if (syncRetries < MAX_SYNC_RETRIES) {
      setTimeout(syncWithServer, RETRY_INTERVAL);
    } else {
      // ถ้าล้มเหลวเกิน MAX_SYNC_RETRIES ครั้ง ให้ลองอีกใน 1 นาที
      syncRetries = 0;
      setTimeout(syncWithServer, SYNC_INTERVAL);
    }
    
    return timeOffset;
  }
}

export function getServerTime() {
  return Date.now() + timeOffset;
}

// ฟังก์ชันใหม่เพื่อตรวจสอบว่าควรทำการซิงค์เวลาใหม่หรือไม่
export function shouldResync() {
  // ถ้าเวลาที่ผ่านมาตั้งแต่การซิงค์ครั้งล่าสุดเกิน 5 นาที
  return Date.now() - lastSyncTime > 5 * 60 * 1000;
}

// ฟังก์ชันใหม่เพื่อคำนวณความคลาดเคลื่อนของเวลาระหว่าง client/server
export function getTimeDrift(serverTimestamp) {
  const currentServerTime = getServerTime();
  return Math.abs(currentServerTime - serverTimestamp);
}

export function showModal(options) {
  const { title, content, buttons } = options;
  
  const modalDialog = createModalDialog(title, content, buttons);
  document.body.appendChild(modalDialog.wrapper);

  const modal = new bootstrap.Modal(modalDialog.element);
  setupModalEventListeners(modal, modalDialog, buttons);
  
  modal.show();
  return modal;
}

function createModalDialog(title, content, buttons) {
  const wrapper = createElementWithClasses('div');
  
  const modalHtml = `
    <div class="modal fade" tabindex="-1">
      <div class="modal-dialog">
        <div class="modal-content bg-dark text-white">
          <div class="modal-header">
            <h5 class="modal-title">${title}</h5>
            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body">${content}</div>
          <div class="modal-footer">
            ${buttons.map(btn => `
              <button type="button" class="btn ${btn.class}" id="${btn.id}">${btn.text}</button>
            `).join('')}
          </div>
        </div>
      </div>
    </div>
  `;

  wrapper.innerHTML = modalHtml;
  const modalElement = wrapper.querySelector('.modal');

  return {
    wrapper,
    element: modalElement
  };
}

function setupModalEventListeners(modal, modalDialog, buttons) {
  buttons.forEach(btn => {
    const buttonElement = modalDialog.element.querySelector(`#${btn.id}`);
    if (buttonElement) {
      buttonElement.onclick = () => {
        btn.onClick();
        modal.hide();
        modalDialog.wrapper.remove();
      };
    }
  });

  modalDialog.element.addEventListener('hidden.bs.modal', () => {
    modalDialog.wrapper.remove();
  });
}

export function showToast(message, type = 'info') {
  const toast = createElementWithClasses('div', 'toast');
  const toastContent = createElementWithClasses('div', 'toast-body');
  toastContent.textContent = message;
  
  toast.classList.add(`bg-${type}`);
  toast.classList.add('text-white');
  appendChildren(toast, [toastContent]);
  
  const toastContainer = document.getElementById('toast-container') || createToastContainer();
  toastContainer.appendChild(toast);
  
  new bootstrap.Toast(toast, { delay: 3000 }).show();
}

function createToastContainer() {
  const container = createElementWithClasses('div', 'toast-container position-fixed bottom-0 end-0 p-3');
  container.id = 'toast-container';
  document.body.appendChild(container);
  return container;
}