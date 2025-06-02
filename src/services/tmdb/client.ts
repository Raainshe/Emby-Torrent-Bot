import axios from 'axios';
import type { TMDBSearchResponse, TMDBSearchResult, TMDBConfiguration } from './types.js';

const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const TMDB_API_KEY = process.env.TMDB_API_KEY;

let tmdbConfig: TMDBConfiguration | null = null;

/**
 * Get TMDB configuration for image URLs
 */
async function getTMDBConfiguration(): Promise<TMDBConfiguration | null> {
    if (tmdbConfig) return tmdbConfig;
    
    if (!TMDB_API_KEY) {
        console.error('TMDB_API_KEY not configured');
        return null;
    }

    try {
        const response = await axios.get(`${TMDB_BASE_URL}/configuration`, {
            params: {
                api_key: TMDB_API_KEY
            }
        });
        
        tmdbConfig = response.data;
        return tmdbConfig;
    } catch (error) {
        console.error('Error fetching TMDB configuration:', error);
        return null;
    }
}

/**
 * Search for movies and TV shows on TMDB
 */
export async function searchTMDB(query: string, mediaType?: 'movie' | 'tv' | 'multi'): Promise<TMDBSearchResult[]> {
    if (!TMDB_API_KEY) {
        console.error('TMDB_API_KEY not configured');
        return [];
    }

    try {
        const endpoint = mediaType && mediaType !== 'multi' ? `/search/${mediaType}` : '/search/multi';
        
        const response = await axios.get(`${TMDB_BASE_URL}${endpoint}`, {
            params: {
                api_key: TMDB_API_KEY,
                query: query,
                page: 1
            }
        });

        const searchResponse: TMDBSearchResponse = response.data;
        return searchResponse.results.slice(0, 3); // Limit to top 3 results
        
    } catch (error) {
        console.error('Error searching TMDB:', error);
        return [];
    }
}

/**
 * Get full poster URL from TMDB poster path
 */
export async function getPosterUrl(posterPath: string | null, size: string = 'w500'): Promise<string | null> {
    if (!posterPath) return null;
    
    const config = await getTMDBConfiguration();
    if (!config) return null;
    
    return `${config.images.secure_base_url}${size}${posterPath}`;
}

/**
 * Get full backdrop URL from TMDB backdrop path
 */
export async function getBackdropUrl(backdropPath: string | null, size: string = 'w780'): Promise<string | null> {
    if (!backdropPath) return null;
    
    const config = await getTMDBConfiguration();
    if (!config) return null;
    
    return `${config.images.secure_base_url}${size}${backdropPath}`;
}

/**
 * Clean torrent title for better TMDB matching
 */
export function cleanTitleForTMDB(title: string): { cleanTitle: string; year: string } {
    // Remove common torrent tags and quality indicators
    const cleaned = title
        .replace(/\b(1080p|720p|480p|4K|BluRay|WEBRip|HDRip|DVDRip|CAMRip|TS|TC|WEB-DL|BDRip)\b/gi, '')
        .replace(/\b(x264|x265|H\.264|H\.265|HEVC|AVC)\b/gi, '')
        .replace(/\b(AAC|AC3|DTS|MP3|FLAC)\b/gi, '')
        .replace(/\b(RARBG|YTS|YIFY|EZTV|TGx)\b/gi, '')
        .replace(/\[[^\]]*\]/g, '') // Remove content in square brackets
        .replace(/\([^)]*\)/g, '') // Remove content in parentheses (except year)
        .replace(/\{[^}]*\}/g, '') // Remove content in curly braces
        .replace(/\.+/g, ' ') // Replace dots with spaces
        .replace(/\s+/g, ' ') // Replace multiple spaces with single space
        .trim();
    
    // Try to extract year if present
    const yearMatch = title.match(/\b(19|20)\d{2}\b/);
    const year = yearMatch ? yearMatch[0] : '';
    
    return { cleanTitle: cleaned, year };
}

/**
 * Find best TMDB match for a torrent title
 */
export async function findBestTMDBMatch(torrentTitle: string, category?: string): Promise<TMDBSearchResult | null> {
    const { cleanTitle, year } = cleanTitleForTMDB(torrentTitle);
    
    if (!cleanTitle) return null;
    
    // Determine media type based on category
    let mediaType: 'movie' | 'tv' | 'multi' = 'multi';
    if (category) {
        if (category.toLowerCase().includes('movie')) {
            mediaType = 'movie';
        } else if (category.toLowerCase().includes('tv') || category.toLowerCase().includes('series')) {
            mediaType = 'tv';
        }
    }
    
    // Search TMDB
    const searchResults = await searchTMDB(cleanTitle, mediaType);
    
    if (searchResults.length === 0) {
        // Try searching without year if no results found
        const titleWithoutYear = cleanTitle.replace(/\b(19|20)\d{2}\b/g, '').trim();
        if (titleWithoutYear !== cleanTitle) {
            return await findBestTMDBMatch(titleWithoutYear, category);
        }
        return null;
    }
    
    // Find best match considering year if available
    if (year) {
        const yearNum = parseInt(year);
        const matchWithYear = searchResults.find(result => {
            const releaseDate = result.release_date || result.first_air_date;
            if (releaseDate) {
                const resultYear = parseInt(releaseDate.split('-')[0] || '0');
                return Math.abs(resultYear - yearNum) <= 1; // Allow 1 year difference
            }
            return false;
        });
        
        if (matchWithYear) return matchWithYear;
    }
    
    // Return first result if no year match found
    return searchResults[0] || null;
} 