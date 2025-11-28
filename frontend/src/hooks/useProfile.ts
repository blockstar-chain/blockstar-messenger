// frontend/src/hooks/useProfile.ts
// BlockStar Cypher - Custom hook for fetching and caching profile data

'use client';

import { useState, useEffect, useCallback } from 'react';
import { 
  resolveProfile, 
  getCachedProfile,
  type BlockStarProfile 
} from '@/lib/profileResolver';

interface UseProfileResult {
  profile: BlockStarProfile | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * Hook to fetch and cache profile data for a username
 */
export function useProfile(username: string | undefined): UseProfileResult {
  const [profile, setProfile] = useState<BlockStarProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchProfile = useCallback(async () => {
    if (!username) {
      setProfile(null);
      return;
    }

    // Check cache first
    const cached = getCachedProfile(username);
    if (cached) {
      setProfile(cached);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const data = await resolveProfile(username);
      setProfile(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load profile');
    } finally {
      setLoading(false);
    }
  }, [username]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  return {
    profile,
    loading,
    error,
    refetch: fetchProfile,
  };
}

/**
 * Hook to fetch multiple profiles at once
 */
export function useProfiles(usernames: string[]): Map<string, BlockStarProfile> {
  const [profiles, setProfiles] = useState<Map<string, BlockStarProfile>>(new Map());

  useEffect(() => {
    if (usernames.length === 0) {
      setProfiles(new Map());
      return;
    }

    // Check cache first
    const cachedProfiles = new Map<string, BlockStarProfile>();
    const toFetch: string[] = [];

    for (const username of usernames) {
      const cached = getCachedProfile(username);
      if (cached) {
        cachedProfiles.set(username.toLowerCase(), cached);
      } else {
        toFetch.push(username);
      }
    }

    if (toFetch.length === 0) {
      setProfiles(cachedProfiles);
      return;
    }

    // Fetch remaining profiles
    Promise.all(toFetch.map(resolveProfile))
      .then((results) => {
        const newProfiles = new Map(cachedProfiles);
        results.forEach((profile, index) => {
          if (profile) {
            newProfiles.set(toFetch[index].toLowerCase(), profile);
          }
        });
        setProfiles(newProfiles);
      })
      .catch((err) => {
        console.error('Error fetching profiles:', err);
        setProfiles(cachedProfiles);
      });
  }, [usernames.join(',')]);

  return profiles;
}

export default useProfile;
