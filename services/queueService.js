class QueueService {
  constructor() {
    this.songQueue = [];
    this.mutex = {
      locked: false,
      lock() {
        if (this.locked) return false;
        this.locked = true;
        return true;
      },
      unlock() {
        this.locked = false;
      }
    };
  }

  getQueue() {
    return this.songQueue;
  }

  addSong(song) {
    if (typeof song === 'string' && song.trim()) {
      this.songQueue.push(song);
      return true;
    }
    return false;
  }

  removeSong(index) {
    if (index >= 0 && index < this.songQueue.length) {
      return this.songQueue.splice(index, 1)[0];
    }
    return null;
  }

  clearQueue(keepFirst = true) {
    if (keepFirst && this.songQueue.length > 0) {
      const currentSong = this.songQueue[0];
      this.songQueue = [currentSong];
    } else {
      this.songQueue = [];
    }
  }

  moveSong(fromIndex, toIndex) {
    if (
      fromIndex >= 0 && fromIndex < this.songQueue.length &&
      toIndex >= 0 && toIndex < this.songQueue.length
    ) {
      const [movedSong] = this.songQueue.splice(fromIndex, 1);
      this.songQueue.splice(toIndex, 0, movedSong);
      return true;
    }
    return false;
  }

  addPlaylistVideos(videos) {
    if (Array.isArray(videos) && videos.every(v => typeof v === 'string' && v.trim())) {
      videos.forEach(video => this.songQueue.push(video));
      return true;
    }
    return false;
  }

  validateQueue() {
    return Array.isArray(this.songQueue) && 
           this.songQueue.every(song => typeof song === 'string' && song.trim());
}
}

module.exports = QueueService;