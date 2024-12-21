// utils/helpers.js
export function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }
  
  export function formatDuration(seconds) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  }
  
  export function createElementWithClasses(tag, classes) {
    const element = document.createElement(tag);
    if (classes) {
      element.className = classes;
    }
    return element;
  }
  
  export function appendChildren(parent, children) {
    children.forEach(child => {
      if (child) {
        parent.appendChild(child);
      }
    });
  }
  
  export function addFadeAnimation(element, direction = 'in') {
    if (direction === 'in') {
      element.style.opacity = '0';
      setTimeout(() => {
        element.style.opacity = '1';
        element.style.transition = 'opacity 0.3s ease-in-out';
      }, 100);
    } else {
      element.style.opacity = '0';
      element.style.transform = 'translateY(20px)';
      element.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
    }
  }
  
  export function handleAsyncOperation(promise, {
    loadingMessage = 'กำลังโหลด...',
    errorMessage = 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง',
    successCallback,
    errorCallback
  } = {}) {
    const loadingElement = createLoadingElement(loadingMessage);
    document.body.appendChild(loadingElement);
  
    return promise
      .then(result => {
        document.body.removeChild(loadingElement);
        if (successCallback) {
          successCallback(result);
        }
        return result;
      })
      .catch(error => {
        document.body.removeChild(loadingElement);
        console.error('Operation failed:', error);
        if (errorCallback) {
          errorCallback(error);
        } else {
          alert(errorMessage);
        }
        throw error;
      });
  }
  
  function createLoadingElement(message) {
    const loadingDiv = document.createElement('div');
    loadingDiv.style.position = 'fixed';
    loadingDiv.style.top = '50%';
    loadingDiv.style.left = '50%';
    loadingDiv.style.transform = 'translate(-50%, -50%)';
    loadingDiv.style.padding = '20px';
    loadingDiv.style.background = 'rgba(0, 0, 0, 0.8)';
    loadingDiv.style.color = 'white';
    loadingDiv.style.borderRadius = '10px';
    loadingDiv.style.zIndex = '9999';
    loadingDiv.textContent = message;
    return loadingDiv;
  }