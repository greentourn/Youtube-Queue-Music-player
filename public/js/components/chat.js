// components/chat.js
import {
    createElementWithClasses,
    appendChildren,
    addFadeAnimation,
    handleAsyncOperation
} from '../utils/helpers.js';

export function initializeChat(socket) {
    initializeChatInterface(socket);
    setupSocketListeners(socket);
}

function initializeChatInterface(socket) {
    const chatMessages = document.getElementById('chatMessages');
    const chatInputContainer = document.querySelector('.chat-input-container');

    if (!chatMessages || !chatInputContainer) {
        console.error('Chat interface elements not found');
        return;
    }

    const input = createElementWithClasses('input', 'chat-input');
    input.type = 'text';
    input.placeholder = 'พิมพ์เพื่อค้นหาเพลง สั่งเล่น หรือถามเกี่ยวกับเพลง...';

    const sendButton = createElementWithClasses('button', 'chat-submit');
    sendButton.innerHTML = '➤';

    chatInputContainer.innerHTML = '';
    appendChildren(chatInputContainer, [input, sendButton]);

    function sendMessage() {
        const message = input.value.trim();
        if (message) {
            addMessageToChat('user', message);
            socket.emit('chat message', message);
            input.value = '';
        }
    }

    sendButton.onclick = sendMessage;
    input.onkeypress = (e) => {
        if (e.key === 'Enter') {
            sendMessage();
        }
    };

    // Welcome message
    setTimeout(() => {
        addMessageToChat('assistant', 'สวัสดีครับ! ผมสามารถช่วยคุณค้นหาเพลง ควบคุมการเล่น และตอบคำถามเกี่ยวกับเพลงได้');
    }, 1000);
}

function setupSocketListeners(socket) {
    socket.on('chat response', ({ message, isCommand }) => {
        const displayMessage = message.replace(/\[COMMAND:\w+(?::\d+)?\]/g, '').trim();
        const commandMatch = message.match(/\[COMMAND:(\w+)(?::(\d+))?\]/);

        if (!isCommand && displayMessage) {
            addMessageToChat('assistant', displayMessage);
        }

        if (commandMatch) {
            handleCommand(commandMatch[1], commandMatch[2]);
        }
    });

    socket.on('search results', ({ results, message }) => {
        if (message) {
            addMessageToChat('assistant', message);
        }
        showSearchResults(socket, results);
    });
}

function handleCommand(command, param) {
    const commands = {
        skip: () => document.getElementById('skipButton')?.click(),
        pause: () => window.player?.pauseVideo?.(),
        play: () => window.player?.playVideo?.(),
        clear: () => document.getElementById('clearQueueBtn')?.click()
    };

    const commandFunction = commands[command];
    if (commandFunction) {
        commandFunction();
    }
}

function addMessageToChat(role, message) {
    const chatMessages = document.getElementById('chatMessages');
    const messageDiv = createElementWithClasses('div', `chat-message ${role}-message`);
    messageDiv.textContent = message;
    addFadeAnimation(messageDiv, 'in');

    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function showSearchResults(socket, results) {
    const chatMessages = document.getElementById('chatMessages');

    // Remove old results
    chatMessages.querySelectorAll('.search-results').forEach(el => el.remove());

    // Create results container
    const resultsContainer = createElementWithClasses('div', 'search-results fade-in');
    const resultElements = results.map(result => createSearchResultItem(socket, result));
    appendChildren(resultsContainer, resultElements);

    chatMessages.appendChild(resultsContainer);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function createSearchResultItem(socket, result) {
    const resultItem = createElementWithClasses('div', 'search-result-item');

    const thumbnailContainer = createThumbnailContainer(result);
    const infoContainer = createInfoContainer(result);
    const addButton = createAddButton(socket, result);

    appendChildren(resultItem, [thumbnailContainer, infoContainer, addButton]);
    return resultItem;
}

function createThumbnailContainer(result) {
    const container = createElementWithClasses('div', 'thumbnail-container');
    const thumbnail = createElementWithClasses('img', 'search-result-thumbnail');

    thumbnail.src = result.thumbnail;
    thumbnail.alt = result.title;
    thumbnail.style.width = '100%';
    thumbnail.style.height = '100%';
    thumbnail.style.objectFit = 'cover';

    container.appendChild(thumbnail);
    return container;
}

function createInfoContainer(result) {
    const container = createElementWithClasses('div', 'search-result-info');

    const title = createElementWithClasses('div', 'search-result-title');
    title.textContent = result.title;

    const channel = createElementWithClasses('div', 'search-result-channel');
    channel.textContent = result.channel;

    appendChildren(container, [title, channel]);
    return container;
}

function createAddButton(socket, result) {
    const addButton = createElementWithClasses('button', 'btn btn-sm btn-primary add-to-queue-btn');
    addButton.textContent = 'Add song';

    addButton.onclick = () => handleAddButtonClick(socket, addButton, result);
    return addButton;
}

async function handleAddButtonClick(socket, button, result) {
    button.disabled = true;
    button.classList.add('loading');
    button.textContent = 'Adding...';

    try {
        await handleAsyncOperation(
            new Promise((resolve) => {
                const videoUrl = `https://www.youtube.com/watch?v=${result.id}`;
                socket.emit('addSong', videoUrl);
                setTimeout(resolve, 500); // Simulate network delay
            }),
            {
                successCallback: () => {
                    button.classList.remove('loading');
                    button.classList.add('success');
                    button.textContent = 'Added!';

                    setTimeout(() => {
                        button.classList.remove('success');
                        button.disabled = false;
                        button.textContent = 'Add song';
                    }, 2000);
                },
                errorCallback: () => {
                    button.classList.remove('loading');
                    button.disabled = false;
                    button.textContent = 'Add song';
                }
            }
        );
    } catch (error) {
        console.error('Error adding song:', error);
    }
}