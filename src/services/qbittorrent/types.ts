export interface TorrentInfo {
    added_on: number;
    amount_left: number;
    auto_tmm: boolean;
    availability: number;
    category: string;
    completed: number;
    completion_on: number;
    content_path: string;
    dl_limit: number;
    dlspeed: number; // Download speed in B/s
    download_path: string;
    downloaded: number;
    downloaded_session: number;
    eta: number;
    f_l_piece_prio: boolean;
    force_start: boolean;
    hash: string;
    infohash_v1: string;
    infohash_v2: string;
    last_activity: number;
    magnet_uri: string;
    max_ratio: number;
    max_seeding_time: number;
    name: string;
    num_complete: number; // Total number of seeds in the swarm (available globally)
    num_incomplete: number; // Total number of leechers in the swarm (available globally)
    num_leechs: number; // Connected leechers
    num_seeds: number; // Connected seeds
    priority: number;
    progress: number;
    ratio: number;
    ratio_limit: number;
    save_path: string;
    seeding_time: number;
    seeding_time_limit: number;
    seen_complete: number;
    seq_dl: boolean;
    size: number;
    state: string;
    super_seeding: boolean;
    tags: string;
    time_active: number;
    total_size: number;
    tracker: string;
    trackers_count: number;
    up_limit: number;
    uploaded: number;
    uploaded_session: number;
    upspeed: number;
}

export interface GetTorrentsResult {
    torrents?: TorrentInfo[];
    error?: string;
}

export interface AddTorrentResult {
    success: boolean;
    error?: string;
    torrent?: TorrentInfo;
}

export const SEEDING_STATES = [
    "uploading",
    "stalledUP",
    "forcedUP",
    "queuedUP",
    "checkingUP"
]; 