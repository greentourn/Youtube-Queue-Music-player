// services/uiService.js
import { createElementWithClasses, appendChildren } from '../utils/helpers.js';

let timeOffset = 0;

export async function syncWithServer() {
  const startTime = Date.now();
  try {
    const response = await fetch('/server-time');
    const { serverTime } = await response.json();
    const endTime = Date.now();
    const networkDelay = (endTime - startTime) / 2;

    timeOffset = serverTime - (startTime + networkDelay);

    setTimeout(syncWithServer, 5 * 60 * 1000);
  } catch (error) {
    console.error('Time sync failed:', error);
    setTimeout(syncWithServer, 10000);
  }
}

export function getServerTime() {
  return Date.now() + timeOffset;
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