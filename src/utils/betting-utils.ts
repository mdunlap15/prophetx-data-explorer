/**
 * Betting Utilities - Phase 1 Deliverable
 * American ↔ decimal odds conversion, stake validation, wager payload building
 */

/**
 * Converts American odds to decimal odds
 * @param a American odds (e.g., +150, -200)
 * @returns Decimal odds (e.g., 2.50, 1.50)
 */
export function americanToDecimal(a: number): number {
  if (!Number.isFinite(a) || a === 0) throw new Error('Invalid American odds');
  return a > 0 ? 1 + a / 100 : 1 + 100 / Math.abs(a);
}

/**
 * Converts decimal odds to American odds
 * @param d Decimal odds (e.g., 2.50, 1.50)
 * @returns American odds (e.g., +150, -200)
 */
export function decimalToAmerican(d: number): number {
  if (!Number.isFinite(d) || d <= 1) throw new Error('Invalid decimal odds');
  return d >= 2 ? Math.round((d - 1) * 100) : Math.round(-100 / (d - 1));
}

/**
 * Parses American odds from input string, preserving sign
 * @param s String input like "-146" or "+150"
 * @returns Parsed American odds with sign preserved
 */
export function parseAmericanString(s: string): number {
  if (typeof s !== 'string') throw new Error('Invalid American odds');
  const trimmed = s.trim();
  const sign = trimmed.startsWith('-') ? -1 : 1;
  const n = Number(trimmed.replace(/[^\d.]/g, ''));
  if (!Number.isFinite(n) || n === 0) throw new Error('Invalid American odds');
  return sign * Math.round(n);
}

/**
 * Cached odds ladder from ProphetX API
 * Will be populated by getOddsLadder() call
 */
let oddsLadder: number[] = [];

/**
 * Sets the odds ladder cache
 */
export function setOddsLadder(ladder: number[]): void {
  oddsLadder = [...ladder].sort((a, b) => a - b);
  console.log(`📊 Odds ladder cached: ${oddsLadder.length} ticks`);
}

/**
 * Gets the cached odds ladder
 */
export function getOddsLadder(): number[] {
  return [...oddsLadder];
}

/**
 * Rounds odds to the nearest valid tick from the odds ladder
 * @param odds Decimal odds to round
 * @returns Nearest valid tick or original odds if ladder not loaded
 */
export function roundToValidTick(odds: number): number {
  if (oddsLadder.length === 0) {
    console.warn('⚠️ Odds ladder not loaded, returning original odds');
    return odds;
  }

  // Convert to American odds for ladder matching (ladder likely in American format)
  const american = decimalToAmerican(odds);
  
  // Find closest tick
  let closest = oddsLadder[0];
  let minDiff = Math.abs(american - closest);
  
  for (const tick of oddsLadder) {
    const diff = Math.abs(american - tick);
    if (diff < minDiff) {
      minDiff = diff;
      closest = tick;
    }
  }

  // Convert back to decimal
  return americanToDecimal(closest);
}

/**
 * Validates stake amount according to ProphetX rules
 * @param stake Stake amount to validate
 * @returns Validation result with error message if invalid
 */
export function validateStake(stake: number): { valid: boolean; error?: string } {
  if (typeof stake !== 'number' || isNaN(stake)) {
    return { valid: false, error: 'Stake must be a valid number' };
  }

  if (stake <= 0) {
    return { valid: false, error: 'Stake must be greater than 0' };
  }

  // Per ProphetX API spec: maximum stake is 100,000,000
  if (stake > 100000000) {
    return { valid: false, error: 'Stake exceeds maximum allowed (100,000,000)' };
  }

  // Minimum stake (assuming 1 cent minimum)
  if (stake < 0.01) {
    return { valid: false, error: 'Stake must be at least 0.01' };
  }

  return { valid: true };
}

/**
 * Generates an idempotent external ID for wager tracking
 * @param prefix Optional prefix for the ID
 * @returns External ID compliant with ProphetX format (max 100 chars, [A-Za-z0-9_-])
 */
export function generateExternalId(prefix: string = 'wager'): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 10);
  const id = `${prefix}_${timestamp}_${random}`;
  
  // Ensure compliance with ProphetX rules: max 100 chars, [A-Za-z0-9_-]
  const sanitized = id.replace(/[^A-Za-z0-9_-]/g, '_').substring(0, 100);
  
  return sanitized;
}

/**
 * ProphetX PlaceWagerRequest schema (from OpenAPI spec)
 * POST /partner/mm/place_wager
 */
export interface PlaceWagerRequest {
  /** Required: line_id from selection */
  line_id: string;
  /** Required: odds in decimal format */
  odds: number;
  /** Required: stake amount */
  stake: number;
  /** Required: external_id for tracking (max 100 chars, [A-Za-z0-9_-]) */
  external_id: string;
  /** Optional: wager strategy (only 'fillOrKill' supported) */
  wager_strategy?: 'fillOrKill';
}

/**
 * Builds a wager payload using exact ProphetX schema
 * @param params Wager parameters
 * @returns Valid PlaceWagerRequest payload
 */
export function buildWagerPayload(params: {
  line_id: string;
  odds: number;
  stake: number;
  external_id?: string;
  wager_strategy?: 'fillOrKill';
}): PlaceWagerRequest {
  // Validate required parameters
  if (!params.line_id || typeof params.line_id !== 'string') {
    throw new Error('line_id is required and must be a string');
  }

  // Validate and round odds
  if (typeof params.odds !== 'number' || params.odds <= 1.0) {
    throw new Error('odds must be a number greater than 1.0');
  }
  const roundedOdds = roundToValidTick(params.odds);

  // Validate stake
  const stakeValidation = validateStake(params.stake);
  if (!stakeValidation.valid) {
    throw new Error(`Invalid stake: ${stakeValidation.error}`);
  }

  // Generate external_id if not provided
  const external_id = params.external_id || generateExternalId();

  const payload: PlaceWagerRequest = {
    line_id: params.line_id,
    odds: roundedOdds,
    stake: params.stake,
    external_id
  };

  // Add optional wager strategy
  if (params.wager_strategy) {
    payload.wager_strategy = params.wager_strategy;
  }

  return payload;
}

/**
 * Calculates potential profit from odds and stake
 * @param odds Decimal odds
 * @param stake Stake amount
 * @returns Potential profit amount
 */
export function calculateProfit(odds: number, stake: number): number {
  return (odds - 1) * stake;
}

/**
 * Calculates total return (stake + profit) from odds and stake
 * @param odds Decimal odds
 * @param stake Stake amount
 * @returns Total return amount
 */
export function calculateReturn(odds: number, stake: number): number {
  return odds * stake;
}

/**
 * Clamps decimal odds to the nearest valid ladder tick
 * @param decimalPrice Decimal odds to clamp
 * @param ladder Array of valid decimal ladder values
 * @returns Nearest valid ladder price or original if ladder unavailable
 */
export function clampToLadder(decimalPrice: number, ladder: number[]): number {
  if (!ladder?.length) return decimalPrice;
  let best = ladder[0], diff = Math.abs(decimalPrice - best);
  for (const p of ladder) {
    const d = Math.abs(decimalPrice - p);
    if (d < diff) { best = p; diff = d; }
  }
  return best;
}

/**
 * Parses American odds from display string like "+150" or "-200"
 * @param display Display odds string
 * @returns Numeric American odds or null if invalid
 */
export function parseDisplayOdds(display: string): number | null {
  if (!display) return null;
  
  const cleaned = display.replace(/[^\d+-]/g, '');
  const parsed = parseInt(cleaned, 10);
  
  return isNaN(parsed) ? null : parsed;
}

/**
 * Self-test function to verify odds conversions
 * Should be called during development to ensure accuracy
 */
export function testOddsConversions(): void {
  console.log('🧪 Testing odds conversions...');
  
  const testCases = [
    { american: 150, decimal: 2.5 },
    { american: -200, decimal: 1.5 },
    { american: 100, decimal: 2.0 },
    { american: -100, decimal: 2.0 },
    { american: 250, decimal: 3.5 },
    { american: -150, decimal: 1.67 }
  ];

  let passed = 0;
  for (const { american, decimal } of testCases) {
    const convertedDecimal = americanToDecimal(american);
    const convertedAmerican = decimalToAmerican(decimal);
    
    const decimalMatch = Math.abs(convertedDecimal - decimal) < 0.01;
    const americanMatch = Math.abs(convertedAmerican - american) < 1;
    
    if (decimalMatch && americanMatch) {
      passed++;
    } else {
      console.error(`❌ Test failed: ${american} <-> ${decimal}`);
      console.error(`  Got: ${convertedDecimal} <-> ${convertedAmerican}`);
    }
  }

  console.log(`✅ Odds conversion tests: ${passed}/${testCases.length} passed`);
}