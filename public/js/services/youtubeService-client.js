// services/youtubeService.js
import { handleAsyncOperation } from '../utils/helpers.js';

export async function fetchVideoDetails(videoId) {
  return handleAsyncOperation(
    fetch(`/youtube-info/${videoId}`),
    {
      loadingMessage: 'กำลังโหลดข้อมูลวิดีโอ...',
      errorMessage: 'ไม่สามารถโหลดข้อมูลวิดีโอได้'
    }
  ).then(response => response.json());
}

export function extractVideoId(url) {
  const videoIdMatch = url.match(/(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?)\/|\S*?[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return videoIdMatch ? videoIdMatch[1] : null;
}

export function extractPlaylistId(url) {
  const playlistMatch = url.match(/[&?]list=([a-zA-Z0-9_-]+)/i);
  return playlistMatch ? playlistMatch[1] : null;
}

export async function searchYouTube(query) {
  return handleAsyncOperation(
    fetch(`/youtube-search?q=${encodeURIComponent(query)}`),
    {
      loadingMessage: 'กำลังค้นหาเพลง...',
      errorMessage: 'ไม่สามารถค้นหาเพลงได้'
    }
  ).then(response => response.json());
}

export async function getPlaylistItems(playlistId, videoId) {
  return handleAsyncOperation(
    fetch(`/youtube-playlist?playlistId=${playlistId}&videoId=${videoId}`),
    {
      loadingMessage: 'กำลังโหลดรายการเพลง...',
      errorMessage: 'ไม่สามารถโหลดรายการเพลงได้'
    }
  ).then(response => response.json());
}