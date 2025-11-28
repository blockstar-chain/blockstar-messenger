import { Message, User, GroupChat, SearchResult } from '@/types';
import { db } from './database';

/**
 * Message Search Service
 * Full-text search across messages, users, and groups
 */

export class SearchService {
  private searchIndex: Map<string, Set<string>> = new Map();
  private initialized: boolean = false;

  /**
   * Initialize search index
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      await this.buildSearchIndex();
      this.initialized = true;
    } catch (error) {
      console.error('Failed to initialize search:', error);
    }
  }

  /**
   * Build search index from all messages
   */
  private async buildSearchIndex(): Promise<void> {
    const messages = await db.messages.toArray();

    for (const message of messages) {
      this.indexMessage(message);
    }
  }

  /**
   * Index a message for search
   */
  indexMessage(message: Message): void {
    const terms = this.tokenize(message.content);

    for (const term of terms) {
      if (!this.searchIndex.has(term)) {
        this.searchIndex.set(term, new Set());
      }
      this.searchIndex.get(term)!.add(message.id);
    }
  }

  /**
   * Tokenize text into searchable terms
   */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((term) => term.length > 2); // Ignore short terms
  }

  /**
   * Search messages
   */
  async searchMessages(query: string): Promise<SearchResult[]> {
    if (!query.trim()) return [];

    const terms = this.tokenize(query);
    const messageIds = new Set<string>();

    // Find messages matching all terms (AND logic)
    for (let i = 0; i < terms.length; i++) {
      const term = terms[i];
      const matches = this.searchIndex.get(term);

      if (!matches) {
        return []; // No results if any term not found
      }

      if (i === 0) {
        matches.forEach((id) => messageIds.add(id));
      } else {
        // Intersect with previous results
        for (const id of messageIds) {
          if (!matches.has(id)) {
            messageIds.delete(id);
          }
        }
      }
    }

    // Get actual messages
    const results: SearchResult[] = [];

    for (const id of messageIds) {
      const message = await db.messages.get(id);
      
      if (message) {
        results.push({
          type: 'message',
          item: message,
          highlights: this.getHighlights(message.content, terms),
          score: this.calculateScore(message, terms),
        });
      }
    }

    // Sort by score
    results.sort((a, b) => b.score - a.score);

    return results;
  }

  /**
   * Search in specific conversation
   */
  async searchInConversation(
    conversationId: string,
    query: string
  ): Promise<SearchResult[]> {
    const allResults = await this.searchMessages(query);
    
    return allResults.filter((result) => {
      if (result.type === 'message') {
        return (result.item as Message).conversationId === conversationId;
      }
      return false;
    });
  }

  /**
   * Search users
   */
  async searchUsers(query: string): Promise<SearchResult[]> {
    if (!query.trim()) return [];

    const users = await db.users.toArray();
    const terms = this.tokenize(query);
    const results: SearchResult[] = [];

    for (const user of users) {
      const userText = `${user.username} ${user.walletAddress} ${user.bio || ''}`;
      const userTerms = this.tokenize(userText);

      let matchCount = 0;
      for (const term of terms) {
        if (userTerms.some((ut) => ut.includes(term))) {
          matchCount++;
        }
      }

      if (matchCount > 0) {
        results.push({
          type: 'user',
          item: user,
          score: (matchCount / terms.length) * 100,
        });
      }
    }

    results.sort((a, b) => b.score - a.score);

    return results;
  }

  /**
   * Search groups
   */
  async searchGroups(query: string): Promise<SearchResult[]> {
    if (!query.trim()) return [];

    const conversations = await db.conversations
      .where('type')
      .equals('group')
      .toArray();

    const terms = this.tokenize(query);
    const results: SearchResult[] = [];

    for (const group of conversations as GroupChat[]) {
      const groupText = `${group.groupName} ${group.groupDescription || ''}`;
      const groupTerms = this.tokenize(groupText);

      let matchCount = 0;
      for (const term of terms) {
        if (groupTerms.some((gt) => gt.includes(term))) {
          matchCount++;
        }
      }

      if (matchCount > 0) {
        results.push({
          type: 'group',
          item: group,
          score: (matchCount / terms.length) * 100,
        });
      }
    }

    results.sort((a, b) => b.score - a.score);

    return results;
  }

  /**
   * Universal search (messages, users, groups)
   */
  async searchAll(query: string): Promise<{
    messages: SearchResult[];
    users: SearchResult[];
    groups: SearchResult[];
  }> {
    const [messages, users, groups] = await Promise.all([
      this.searchMessages(query),
      this.searchUsers(query),
      this.searchGroups(query),
    ]);

    return { messages, users, groups };
  }

  /**
   * Get highlighted text
   */
  private getHighlights(text: string, terms: string[]): string[] {
    const highlights: string[] = [];
    const lowerText = text.toLowerCase();

    for (const term of terms) {
      const index = lowerText.indexOf(term);
      if (index !== -1) {
        const start = Math.max(0, index - 20);
        const end = Math.min(text.length, index + term.length + 20);
        highlights.push(text.substring(start, end));
      }
    }

    return highlights;
  }

  /**
   * Calculate relevance score
   */
  private calculateScore(message: Message, terms: string[]): number {
    const content = message.content.toLowerCase();
    let score = 0;

    for (const term of terms) {
      // Exact match
      if (content.includes(term)) {
        score += 10;
      }

      // Word boundary match
      const regex = new RegExp(`\\b${term}\\b`, 'i');
      if (regex.test(content)) {
        score += 20;
      }
    }

    // Recency bonus (newer messages score higher)
    const ageInDays = (Date.now() - message.timestamp) / (1000 * 60 * 60 * 24);
    const recencyBonus = Math.max(0, 10 - ageInDays);
    score += recencyBonus;

    return score;
  }

  /**
   * Clear search index
   */
  clearIndex(): void {
    this.searchIndex.clear();
    this.initialized = false;
  }

  /**
   * Rebuild search index
   */
  async rebuildIndex(): Promise<void> {
    this.clearIndex();
    await this.initialize();
  }
}

export const searchService = new SearchService();
