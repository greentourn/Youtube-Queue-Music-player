// components/queue.js
import { fetchVideoDetails, extractVideoId } from '../services/youtubeService-client.js';
import { showModal } from '../services/uiService.js';
import { createElementWithClasses, appendChildren, addFadeAnimation, handleAsyncOperation } from '../utils/helpers.js';

let songQueue = [];

export function initializeQueue(socket) {
    setupEventListeners(socket);
    setupSocketListeners(socket);
    socket.emit('getInitialState');
}

function setupEventListeners(socket) {
    document.getElementById('addSongButton').addEventListener('click', () => addSong(socket));
    document.getElementById('clearQueueBtn').addEventListener('click', () => showClearQueueModal(socket));
    document.getElementById('songInput').addEventListener('keypress', (event) => {
        if (event.key === 'Enter') {
            addSong(socket);
        }
    });
    document.getElementById('skipButton').addEventListener('click', () => {
        socket.emit('skipSong');
    });
}

function setupSocketListeners(socket) {
    socket.on('queueUpdated', (queue) => {
        if (Array.isArray(queue)) {  // เพิ่มการตรวจสอบ
            updateQueue(socket, queue);
        }
    });

    socket.on('initialQueue', (queue) => {
        if (Array.isArray(queue)) {  // เพิ่มการตรวจสอบ
            updateQueue(socket, queue);
        }
    });

    socket.on('playlistFound', ({ videos, originalVideo }) => {
        showPlaylistModal(socket, videos, originalVideo);
    });
}

async function updateQueue(socket, queue) {
    const queueList = document.getElementById('queue');
    if (!queueList) return;  // เพิ่มการตรวจสอบ

    // เก็บ reference ของ queue ไว้ใช้งาน
    songQueue = queue;
    
    // ล้าง queue เดิม
    queueList.innerHTML = '';

    // สร้าง queue items ใหม่ทั้งหมด เริ่มจาก index 1
    for (let i = 1; i < queue.length; i++) {
        try {
            const song = queue[i];
            if (song) {  // Check if song exists
                const listItem = await createQueueItem(socket, song, i);
                if (listItem) {  // Check if item was created successfully
                    queueList.appendChild(listItem);
                }
            }
        } catch (error) {
            console.error('Error creating queue item:', error);
        }
    }
}

async function createQueueItem(socket, song, index) {
    const listItem = createElementWithClasses('div', 'list-group-item song-item');
    addFadeAnimation(listItem, 'in');

    const videoId = extractVideoId(song);
    if (!videoId) return null;  // Skip invalid songs

    try {
        const videoDetails = await fetchVideoDetails(videoId);
        
        // Create queue item content
        const content = {
            playButton: createPlayButtonContainer(socket, index),
            thumbnail: createThumbnail(videoDetails),
            title: createTitleText(videoDetails),
            controls: createControls(socket, index)
        };

        // Append all content elements
        Object.values(content).forEach(element => {
            if (element) listItem.appendChild(element);
        });

        return listItem;
    } catch (error) {
        console.error('Error fetching video details:', error);
        return null;
    }
}

function createLoadingIndicator() {
    return createElementWithClasses('div', 'spinner-border text-primary');
}

function createQueueItemContent(socket, videoDetails, index) {
    const playButtonContainer = createPlayButtonContainer(socket, index);
    const thumbnail = createThumbnail(videoDetails);
    const titleText = createTitleText(videoDetails);
    const controls = createControls(socket, index);

    return {
        playButton: playButtonContainer,
        thumbnail: thumbnail,
        title: titleText,
        controls: controls
    };
}

function createPlayButtonContainer(socket, index) {
    const container = createElementWithClasses('div', 'play-button-container');
    const playButton = createElementWithClasses('button', 'btn btn-link btn-sm play-button');

    playButton.innerHTML = '▶️';
    playButton.title = 'เล่นเพลงนี้ทันที';

    playButton.onclick = () => {
        addFadeAnimation(playButton, 'click');
        setTimeout(() => {
            socket.emit('playSongFromQueue', index);
        }, 200);
    };

    container.appendChild(playButton);
    return container;
}

function createThumbnail(videoDetails) {
    const thumbnail = createElementWithClasses('img', 'me-3');
    thumbnail.src = videoDetails.thumbnails.default.url;
    thumbnail.alt = videoDetails.title;
    return thumbnail;
}

function createTitleText(videoDetails) {
    const titleText = createElementWithClasses('span', 'd-flex text-white');
    titleText.textContent = videoDetails.title;
    return titleText;
}

function createControls(socket, index) {
    const controlsElement = createElementWithClasses('div', 'song-controls');

    const upButton = createControlButton('⬆️', 'btn-secondary', () => {
        if (index > 1) socket.emit('moveSong', index, index - 1);
    }, index <= 1);

    const downButton = createControlButton('⬇️', 'btn-secondary', () => {
        if (index < songQueue.length - 1) socket.emit('moveSong', index, index + 1);
    }, index >= songQueue.length - 1);

    const removeButton = createControlButton('🗑️', 'btn-danger', () => {
        removeSong(socket, index);
    });

    appendChildren(controlsElement, [upButton, downButton, removeButton]);
    return controlsElement;
}

function createControlButton(text, className, onClick, disabled = false) {
    const button = createElementWithClasses('button', `btn ${className} btn-sm ms-2`);
    button.textContent = text;
    button.onclick = onClick;
    button.disabled = disabled;
    return button;
}

function handleVideoLoadError(listItem, loadingIndicator, index, socket) {
    listItem.removeChild(loadingIndicator);
    const errorText = createElementWithClasses('span', 'text-danger');
    errorText.textContent = 'ไม่สามารถโหลดข้อมูลวิดีโอได้';
    listItem.appendChild(errorText);
    socket.emit('removeSong', index);
}

function addSong(socket) {
    const songInput = document.getElementById('songInput');
    const song = songInput.value;
    if (song) {
        socket.emit('addSong', song);
        songInput.value = '';
    }
}

function removeSong(socket, index) {
    const listItem = document.querySelectorAll('.song-item')[index - 1];
    listItem.classList.add('fade-out');

    setTimeout(() => {
        socket.emit('removeSong', index);
    }, 300);
}

function skipSong() {
    socket.emit('skipSong');
}

function showClearQueueModal(socket) {
    showModal({
        title: 'ยืนยันการเคลียร์คิว',
        content: `
      <p>คุณแน่ใจหรือไม่ที่จะเคลียร์คิวเพลงทั้งหมด?</p>
      <small class="text-muted">เพลงที่กำลังเล่นอยู่จะไม่ถูกลบ</small>
    `,
        buttons: [
            {
                id: 'cancel-clear',
                text: 'ยกเลิก',
                class: 'btn btn-secondary',
                onClick: () => { }
            },
            {
                id: 'confirm-clear',
                text: 'ยืนยันการเคลียร์',
                class: 'btn btn-danger',
                onClick: () => {
                    const queueItems = document.querySelectorAll('.list-group-item');
                    queueItems.forEach(item => item.classList.add('fade-out'));
                    setTimeout(() => socket.emit('clearQueue'), 300);
                }
            }
        ]
    });
}

function showPlaylistModal(socket, videos, originalVideo) {
    showModal({
        title: 'พบ Playlist',
        content: `
      <p>คุณต้องการเพิ่มเพลงจาก playlist นี้อย่างไร?</p>
      <p class="text-muted small">หมายเหตุ: การเพิ่มทุกเพลงจะเริ่มจากเพลงที่คุณเลือก และเพิ่มเพลงที่เหลือตามลำดับใน playlist</p>
    `,
        buttons: [
            {
                id: 'cancel-playlist',
                text: 'ยกเลิก',
                class: 'btn btn-secondary',
                onClick: () => { }
            },
            {
                id: 'add-single',
                text: 'เพิ่มเพลงที่เลือกมา',
                class: 'btn btn-primary',
                onClick: () => socket.emit('addPlaylistVideos', [originalVideo])
            },
            {
                id: 'add-all',
                text: `เพิ่มทุกเพลง (${videos.length} เพลง)`,
                class: 'btn btn-success',
                onClick: () => socket.emit('addPlaylistVideos', videos)
            }
        ]
    });
}