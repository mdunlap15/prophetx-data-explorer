/**
 * Selection Cache Service - Phase 1 Deliverable
 * Creates ID-first index: eventId → marketId → lineKey → selectionId → SelectionRecord
 * Focused on line_id extraction and flexible findSelection() method
 */

import { TreeNode } from './prophetx-api';

export interface SelectionRecord {
  /** The actual API line_id required for wager placement */
  line_id: string;
  /** Internal UI identifier for tree navigation */
  internalId: string;
  /** Display name for UI */
  name: string;
  /** Current odds in decimal format */
  odds: number | null;
  /** Current stake/volume */
  stake: number | null;
  /** Line value (spread/total point) */
  line: number | string | null;
  /** Event ID this selection belongs to */
  eventId: string;
  /** Market ID this selection belongs to */
  marketId: string;
  /** Normalized line key for grouping */
  lineKey: string;
  /** Raw selection data */
  rawData: any;
}

export interface SelectionSearchParams {
  eventId?: string;
  marketId?: string;
  lineKey?: string;
  line_id?: string;
  internalId?: string;
  name?: string;
}

class SelectionCache {
  private cache: Map<string, Map<string, Map<string, Map<string, SelectionRecord>>>> = new Map();
  private line_idIndex: Map<string, SelectionRecord> = new Map();
  private lastUpdated: Date | null = null;

  /**
   * Builds the cache from TreeNode hierarchy
   * Extracts line_id from node.data.line_id and excludes selections without it
   */
  buildFromTreeData(treeData: TreeNode[]): void {
    console.log('🏗️ Building selection cache from tree data...');
    this.cache.clear();
    this.line_idIndex.clear();
    
    let totalSelections = 0;
    let selectionsWithLineId = 0;

    for (const tournament of treeData) {
      if (tournament.children) {
        for (const event of tournament.children) {
          const eventId = event.id;
          
          if (!this.cache.has(eventId)) {
            this.cache.set(eventId, new Map());
          }
          const eventCache = this.cache.get(eventId)!;

          if (event.children) {
            for (const category of event.children) {
              if (category.children) {
                for (const market of category.children) {
                  const marketId = market.id;
                  
                  if (!eventCache.has(marketId)) {
                    eventCache.set(marketId, new Map());
                  }
                  const marketCache = eventCache.get(marketId)!;

                  if (market.children) {
                    for (const selectionGroup of market.children) {
                      const lineKey = this.normalizeLineKey(selectionGroup.data?.line);
                      
                      if (!marketCache.has(lineKey)) {
                        marketCache.set(lineKey, new Map());
                      }
                      const lineCache = marketCache.get(lineKey)!;

                      if (selectionGroup.children) {
                        for (const selection of selectionGroup.children) {
                          totalSelections++;
                          
                          // Debug: log the selection structure to understand line_id location
                          console.log(`🔍 Selection structure:`, {
                            name: selection.name,
                            id: selection.id,
                            data: selection.data,
                            dataKeys: selection.data ? Object.keys(selection.data) : 'no data'
                          });

                          // Try multiple possible line_id sources
                          const lineId = 
                            (selection.data?.line_id as string) ||
                            (selection.id as string);

                          if (!lineId || typeof lineId !== 'string') {
                            console.log(`⚠️ Skipping selection without line_id: ${selection.name}`, selection);
                            continue;
                          }

                          selectionsWithLineId++;
                          const record: SelectionRecord = {
                            line_id: lineId,
                            internalId: selection.id,
                            name: selection.name,
                            odds: selection.data?.odds ?? null,
                            stake: selection.data?.stake ?? null,
                            line: selection.data?.line ?? null,
                            eventId,
                            marketId,
                            lineKey,
                            rawData: selection.data
                          };

                          lineCache.set(selection.id, record);
                          this.line_idIndex.set(lineId, record);
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }

    this.lastUpdated = new Date();
    console.log(`✅ Cache built: ${selectionsWithLineId}/${totalSelections} selections with line_id`);
  }

  /**
   * Normalizes line keys for consistent indexing
   * Converts numeric strings to numbers, handles null/undefined
   */
  private normalizeLineKey(line: unknown): string {
    if (line === null || line === undefined) return '__default__';
    const str = String(line);
    const num = Number(str);
    return Number.isNaN(num) ? str : num.toString();
  }

  /**
   * Flexible selection finder supporting multiple search parameters
   * Returns first match or null if not found
   */
  findSelection(params: SelectionSearchParams): SelectionRecord | null {
    // Fast path: direct line_id lookup
    if (params.line_id) {
      return this.line_idIndex.get(params.line_id) || null;
    }

    // Hierarchical search
    const eventCache = params.eventId ? this.cache.get(params.eventId) : null;
    if (!eventCache && params.eventId) return null;

    const searchEvents = eventCache ? [eventCache] : Array.from(this.cache.values());

    for (const eventMap of searchEvents) {
      const marketCache = params.marketId ? eventMap.get(params.marketId) : null;
      if (!marketCache && params.marketId) continue;

      const searchMarkets = marketCache ? [marketCache] : Array.from(eventMap.values());

      for (const marketMap of searchMarkets) {
        const lineCache = params.lineKey ? marketMap.get(params.lineKey) : null;
        if (!lineCache && params.lineKey) continue;

        const searchLines = lineCache ? [lineCache] : Array.from(marketMap.values());

        for (const lineMap of searchLines) {
          for (const record of lineMap.values()) {
            // Check remaining filters
            if (params.internalId && record.internalId !== params.internalId) continue;
            if (params.name && record.name !== params.name) continue;
            
            return record;
          }
        }
      }
    }

    return null;
  }

  /**
   * Gets all selections for an event (wager-eligible only)
   */
  getEventSelections(eventId: string): SelectionRecord[] {
    const eventCache = this.cache.get(eventId);
    if (!eventCache) return [];

    const selections: SelectionRecord[] = [];
    for (const marketMap of eventCache.values()) {
      for (const lineMap of marketMap.values()) {
        for (const record of lineMap.values()) {
          selections.push(record);
        }
      }
    }

    return selections;
  }

  /**
   * Gets all selections for a market
   */
  getMarketSelections(eventId: string, marketId: string): SelectionRecord[] {
    const marketCache = this.cache.get(eventId)?.get(marketId);
    if (!marketCache) return [];

    const selections: SelectionRecord[] = [];
    for (const lineMap of marketCache.values()) {
      for (const record of lineMap.values()) {
        selections.push(record);
      }
    }

    return selections;
  }

  /**
   * Gets cache statistics
   */
  getStats() {
    let totalSelections = 0;
    let eventCount = this.cache.size;
    let marketCount = 0;

    for (const eventMap of this.cache.values()) {
      marketCount += eventMap.size;
      for (const marketMap of eventMap.values()) {
        for (const lineMap of marketMap.values()) {
          totalSelections += lineMap.size;
        }
      }
    }

    return {
      events: eventCount,
      markets: marketCount,
      selections: totalSelections,
      lastUpdated: this.lastUpdated,
      line_idCount: this.line_idIndex.size
    };
  }

  /**
   * Clears the cache
   */
  clear(): void {
    this.cache.clear();
    this.line_idIndex.clear();
    this.lastUpdated = null;
  }
}

export function flattenSelectionCache(cache: SelectionCache): SelectionRecord[] {
  const records: SelectionRecord[] = [];
  for (const eventMap of (cache as any).cache.values()) {
    for (const marketMap of eventMap.values()) {
      for (const lineMap of marketMap.values()) {
        for (const record of lineMap.values()) {
          records.push(record);
        }
      }
    }
  }
  return records;
}

export const selectionCache = new SelectionCache();