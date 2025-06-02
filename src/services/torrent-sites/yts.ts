import axios from 'axios';
import type { TorrentSearchResult, TorrentSearchResponse, SearchOptions } from './types.js';

const YTS_API_URL = 'https://yts.mx/api/v2';

/**
 * Search movies on YTS via their API
 */
export async function searchYTS(options: SearchOptions): Promise<TorrentSearchResponse> {
    try {
        // YTS only supports movies
        if (options.category !== 'movies' && options.category !== 'all') {
            return {
                results: [],
                totalResults: 0,
                page: 1,
                totalPages: 0,
                error: 'YTS only supports movies'
            };
        }

        const { query, page = 1 } = options;
        
        console.log(`Searching YTS for movies: ${query}`);
        
        const response = await axios.get(`${YTS_API_URL}/list_movies.json`, {
            params: {
                query_term: query,
                page: page,
                limit: 20,
                sort_by: 'seeds',
                order_by: 'desc'
            },
            timeout: 10000
        });

        if (response.data.status !== 'ok' || !response.data.data.movies) {
            return {
                results: [],
                totalResults: 0,
                page: 1,
                totalPages: 0
            };
        }

        const movies = response.data.data.movies;
        const results: TorrentSearchResult[] = [];

        for (const movie of movies) {
            // YTS provides multiple quality torrents per movie
            if (movie.torrents && movie.torrents.length > 0) {
                for (const torrent of movie.torrents) {
                    // Skip if no magnet/hash info
                    if (!torrent.hash) continue;
                    
                    // Build magnet link from hash and trackers
                    const magnetLink = `magnet:?xt=urn:btih:${torrent.hash}&dn=${encodeURIComponent(movie.title + ' ' + movie.year + ' ' + torrent.quality)}&tr=udp://tracker.openbittorrent.com:80&tr=udp://tracker.publicbt.com:80`;
                    
                    results.push({
                        title: `${movie.title} (${movie.year}) [${torrent.quality}]`,
                        size: torrent.size || 'Unknown',
                        seeds: torrent.seeds || 0,
                        leeches: torrent.peers || 0,
                        magnetLink,
                        category: 'movies',
                        uploadDate: movie.date_uploaded || 'Unknown',
                        uploader: 'YTS',
                        site: 'YTS',
                        detailUrl: `https://yts.mx/movies/${movie.slug}`
                    });
                }
            }
        }

        // Sort by seeders descending
        results.sort((a, b) => b.seeds - a.seeds);

        const totalMovies = response.data.data.movie_count || 0;
        const limit = 20;
        
        console.log(`Found ${results.length} torrents from ${movies.length} movies on YTS`);

        return {
            results,
            totalResults: totalMovies,
            page,
            totalPages: Math.ceil(totalMovies / limit)
        };

    } catch (error) {
        console.error('Error searching YTS:', error);
        
        if (axios.isAxiosError(error)) {
            if (error.response?.status === 403) {
                return {
                    results: [],
                    totalResults: 0,
                    page: 1,
                    totalPages: 0,
                    error: 'YTS is blocking requests'
                };
            }
        }
        
        return {
            results: [],
            totalResults: 0,
            page: 1,
            totalPages: 0,
            error: error instanceof Error ? error.message : 'Unknown error occurred'
        };
    }
}

/**
 * Get magnet link for YTS torrent (already provided in search results)
 */
export async function getMagnetLinkYTS(torrent: TorrentSearchResult): Promise<string | null> {
    // YTS provides magnet links directly in search results
    return torrent.magnetLink && torrent.magnetLink.startsWith('magnet:') ? torrent.magnetLink : null;
} 