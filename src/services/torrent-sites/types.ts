export interface TorrentSearchResult {
    title: string;
    size: string;
    seeds: number;
    leeches: number;
    magnetLink: string;
    category: string;
    uploadDate: string;
    uploader: string;
    site: string; // e.g., '1337x', 'TPB'
    detailUrl?: string; // URL to fetch magnet link from
}

export interface TorrentSearchResponse {
    results: TorrentSearchResult[];
    totalResults: number;
    page: number;
    totalPages: number;
    error?: string;
}

export interface SearchOptions {
    query: string;
    category?: string;
    page?: number;
    sortBy?: 'date' | 'size' | 'seeders' | 'leechers';
    sortOrder?: 'asc' | 'desc';
}

export type TorrentCategory = 'all' | 'movies' | 'tv' | 'anime' | 'games' | 'apps' | 'music' | 'other'; 