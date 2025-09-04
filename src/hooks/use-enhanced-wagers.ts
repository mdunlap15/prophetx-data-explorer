/**
 * Enhanced Wager Hook - Enriches wagers with user-friendly display data
 */

import { useMemo } from 'react';
import { useWagerPolling } from './use-wager-polling';
import { WagerHistory, TreeNode } from '@/services/prophetx-api';
import { selectionCache, SelectionRecord } from '@/services/selection-cache';
import { decimalToAmerican } from '@/utils/betting-utils';

interface EnrichedWager extends WagerHistory {
  displayData: {
    wagerType: string;
    wagerMarket: string;
    selectionName: string;
    formattedOdds: string;
    formattedStake: string;
  };
}

interface UseEnhancedWagersOptions {
  eventId?: string;
  marketId?: string;
  enabled?: boolean;
  pollInterval?: number;
  maxRetries?: number;
  treeData?: TreeNode[];
}

export function useEnhancedWagers(options: UseEnhancedWagersOptions = {}) {
  const { treeData, ...pollingOptions } = options;
  
  const { 
    wagers: rawWagers, 
    isLoading, 
    error, 
    lastSyncedAt, 
    hasMore, 
    loadMore, 
    refresh, 
    clear 
  } = useWagerPolling(pollingOptions);

  // Enrich wagers with display data
  const enrichedWagers = useMemo(() => {
    return rawWagers.map((wager): EnrichedWager => {
      const displayData = enrichWagerData(wager, treeData);
      return {
        ...wager,
        displayData
      };
    });
  }, [rawWagers, treeData]);

  return {
    wagers: enrichedWagers,
    isLoading,
    error,
    lastSyncedAt,
    hasMore,
    loadMore,
    refresh,
    clear
  };
}

function enrichWagerData(wager: WagerHistory, treeData?: TreeNode[]) {
  // Try to find selection in cache
  const selection = selectionCache.findSelection({ line_id: wager.line_id });
  
  // Default fallback values
  let wagerType = 'Unknown Market';
  let wagerMarket = `Line ID: ${wager.line_id}`;
  let selectionName = 'Unknown Selection';

  if (selection) {
    // Extract market and event info from selection
    const marketInfo = findMarketInfo(selection, treeData);
    wagerType = marketInfo.marketName || 'Unknown Market';
    wagerMarket = marketInfo.eventName || 'Unknown Event';
    selectionName = selection.name || 'Unknown Selection';
  }

  // Format odds and stake
  const americanOdds = decimalToAmerican(wager.odds);
  const formattedOdds = americanOdds !== null 
    ? (americanOdds > 0 ? `+${americanOdds}` : `${americanOdds}`)
    : `${wager.odds.toFixed(2)}`;
  
  const formattedStake = wager.stake.toString();

  return {
    wagerType,
    wagerMarket,
    selectionName,
    formattedOdds,
    formattedStake
  };
}

function findMarketInfo(selection: SelectionRecord, treeData?: TreeNode[]) {
  if (!treeData) {
    return { marketName: null, eventName: null };
  }

  // Find the market and event by traversing tree data
  for (const tournament of treeData) {
    if (tournament.children) {
      for (const event of tournament.children) {
        if (event.children && event.id === selection.eventId) {
          // Found the event, now find the market
          for (const market of event.children) {
            if (market.id === selection.marketId) {
              return {
                marketName: cleanMarketName(market.name),
                eventName: formatEventName(event.name, event.data?.scheduled)
              };
            }
          }
        }
      }
    }
  }

  return { marketName: null, eventName: null };
}

function cleanMarketName(marketName: string): string {
  // Remove common prefixes and clean up market names
  return marketName
    .replace(/^(MM_|Market_|Mkt_)/i, '')
    .replace(/_/g, ' ')
    .trim();
}

function formatEventName(eventName: string, scheduled?: string): string {
  // Format event name with optional date/time
  let formatted = eventName;
  
  if (scheduled) {
    try {
      const date = new Date(scheduled);
      const options: Intl.DateTimeFormatOptions = {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      };
      const dateStr = date.toLocaleDateString('en-US', options);
      formatted = `${eventName} ${dateStr}`;
    } catch (e) {
      // If date parsing fails, just use event name
    }
  }
  
  return formatted;
}