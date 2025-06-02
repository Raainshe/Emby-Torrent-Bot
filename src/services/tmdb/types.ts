export interface TMDBSearchResult {
    id: number;
    title?: string; // For movies
    name?: string; // For TV shows
    overview: string;
    poster_path: string | null;
    backdrop_path: string | null;
    release_date?: string; // For movies
    first_air_date?: string; // For TV shows
    vote_average: number;
    vote_count: number;
    genre_ids: number[];
    media_type?: 'movie' | 'tv';
    original_language: string;
    popularity: number;
}

export interface TMDBSearchResponse {
    page: number;
    results: TMDBSearchResult[];
    total_pages: number;
    total_results: number;
}

export interface TMDBGenre {
    id: number;
    name: string;
}

export interface TMDBConfiguration {
    images: {
        base_url: string;
        secure_base_url: string;
        backdrop_sizes: string[];
        logo_sizes: string[];
        poster_sizes: string[];
        profile_sizes: string[];
        still_sizes: string[];
    };
}

export interface EnrichedTorrentResult {
    torrent: any; // Will be extended from TorrentSearchResult
    tmdb?: TMDBSearchResult;
    poster_url?: string;
    backdrop_url?: string;
} 