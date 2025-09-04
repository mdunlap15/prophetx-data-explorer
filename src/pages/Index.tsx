import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { AuthForm } from '@/components/AuthForm';
import { DataTreeView } from '@/components/DataTreeView';
import { prophetXAPI, TreeNode } from '@/services/prophetx-api';
import { selectionCache, flattenSelectionCache } from '@/services/selection-cache';
import { useWagerPolling } from '@/hooks/use-wager-polling';
import { americanToDecimal, decimalToAmerican, parseDisplayOdds, buildWagerPayload } from '@/utils/betting-utils';

export default function Index() {
  // Authentication state
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Data state
  const [treeData, setTreeData] = useState<TreeNode[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);

  // Odds ladder removed - supporting any integer American odds

  // Wager composer state
  const [oddsMode, setOddsMode] = useState<'american' | 'decimal'>('american');
  const [oddsInput, setOddsInput] = useState('');
  const [stakeInput, setStakeInput] = useState('');
  const [activeSel, setActiveSel] = useState<{
    line_id: string;
    displayName: string;
    marketName: string;
    eventId: number;
  } | null>(null);
  const [wagerError, setWagerError] = useState<string | null>(null);
  const [isPlacingWager, setIsPlacingWager] = useState(false);

  // Wager polling
  const { wagers, isLoading: isWagersLoading, refresh: refreshWagers } = useWagerPolling({
    enabled: isAuthenticated,
    pollInterval: 15000
  });

  // Test wager state
  const [lastWagerId, setLastWagerId] = useState<string>('');

  const { toast } = useToast();
  const cancelRef = useRef<boolean>(false);

  // Odds ladder loading removed - supporting any integer American odds directly

  // Derived values for wager composer  
  const baseDecimal = oddsMode === 'american' 
    ? americanToDecimal(Number(oddsInput))
    : Number(oddsInput);

  const decimalToSend = baseDecimal; // Direct conversion, no ladder clamping

  // Button enable conditions - simplified without odds ladder
  const canPlaceWager = 
    !!activeSel?.line_id &&
    Number(stakeInput) > 0 &&
    decimalToSend &&
    decimalToSend > 1.01 &&
    decimalToSend < 1000;

  const handleAuthentication = async (accessKey: string, secretKey: string) => {
    setIsAuthenticating(true);
    setAuthError(null);
    try {
      await prophetXAPI.authenticate(accessKey, secretKey);
      setIsAuthenticated(true);
      toast({
        title: "Authentication successful",
        description: "You can now load market data and place test wagers"
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Authentication failed';
      setAuthError(message);
      toast({
        title: "Authentication failed",
        description: message,
        variant: "destructive"
      });
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handleLoadData = async () => {
    if (!isAuthenticated) return;
    
    setIsLoadingData(true);
    setDataError(null);
    
    try {
      console.log('🔄 Loading ProphetX data...');
      const hierarchy = await prophetXAPI.buildHierarchy();
      setTreeData(hierarchy);
      
      // Update selection cache
      selectionCache.buildFromTreeData(hierarchy);
      
      console.log('✅ Data loaded successfully');
      toast({
        title: "Data loaded",
        description: "Market hierarchy has been loaded successfully"
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load data';
      setDataError(message);
      toast({
        title: "Load failed",
        description: message,
        variant: "destructive"
      });
    } finally {
      setIsLoadingData(false);
    }
  };

  const handleOddsToggle = () => {
    if (oddsInput) {
      const currentNum = Number(oddsInput);
      if (Number.isFinite(currentNum)) {
        if (oddsMode === 'american') {
          // Converting from American to decimal
          const decimal = americanToDecimal(currentNum);
          if (decimal !== null) {
            setOddsInput(decimal.toFixed(4));
          }
        } else {
          // Converting from decimal to American
          const american = decimalToAmerican(currentNum);
          if (american !== null) {
            setOddsInput(american.toString());
          }
        }
      }
    }
    setOddsMode(oddsMode === 'american' ? 'decimal' : 'american');
  };

  const handleSelectionChange = (sel: { 
    line_id: string; 
    displayName: string; 
    marketName: string; 
    eventId: number; 
  }) => {
    setActiveSel(sel);
    setWagerError(null);
    
    // Try to prefill odds from display_odds if available
    const selection = selectionCache.findSelection({ line_id: sel.line_id });
    if (selection?.rawData?.display_odds) {
      const displayOdds = selection.rawData.display_odds;
      const parsed = parseDisplayOdds(displayOdds);
      if (parsed !== null) {
        // It's American odds
        setOddsMode('american');
        setOddsInput(Math.abs(parsed).toString());
      }
    }
  };

  const handleTestWager = async () => {
    if (!activeSel || !canPlaceWager) return;
    
    setIsPlacingWager(true);
    setWagerError(null);
    
    try {
      // Use buildWagerPayload to convert decimal odds to American format
      const wagerPayload = buildWagerPayload({
        line_id: activeSel.line_id,
        odds: decimalToSend,
        stake: Number(stakeInput),
        external_id: `px-${Date.now()}`
      });
      
      const result = await prophetXAPI.placeWager(wagerPayload);
      
      if (result.success && result.wager?.wager_id) {
        setLastWagerId(result.wager.wager_id);
        toast({
          title: "Wager placed successfully",
          description: `Wager ID: ${result.wager.wager_id}`
        });
      } else {
        toast({
          title: "Wager placed",
          description: "Success but no wager ID returned"
        });
      }
      
      // Refresh wager list
      refreshWagers();
    } catch (error: any) {
      const message = `${error.code || ''} ${error.message || error}`.trim();
      setWagerError(message);
      toast({
        title: "Place wager failed",
        description: message,
        variant: "destructive"
      });
    } finally {
      setIsPlacingWager(false);
    }
  };

  const handleTestCancel = async () => {
    if (!lastWagerId) return;
    
    try {
      await prophetXAPI.cancelWager({ wager_id: lastWagerId });
      toast({
        title: "Wager cancelled",
        description: `Cancelled wager: ${lastWagerId}`
      });
      setLastWagerId('');
      refreshWagers();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Cancel failed';
      toast({
        title: "Cancel failed",
        description: message,
        variant: "destructive"
      });
    }
  };

  // Compute data summary
  const cacheStats = selectionCache.getStats();
  const wagerEligible = flattenSelectionCache(selectionCache).length;

  return (
    <div className="container mx-auto py-8 space-y-8">
      <div className="text-center space-y-4">
        <h1 className="text-4xl font-bold">ProphetX Data Proof Tool</h1>
        <p className="text-lg text-muted-foreground">
          A comprehensive tool for testing ProphetX API integration, market data retrieval, and wager placement functionality.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Left Column: Auth & Data Tree */}
        <div className="space-y-6">
          <AuthForm 
            onAuthenticated={handleAuthentication}
            isLoading={isAuthenticating}
            error={authError}
          />
          
          <DataTreeView
            data={treeData}
            onLoadData={handleLoadData}
            isLoading={isLoadingData}
            isAuthenticated={isAuthenticated}
            onSelectSelection={handleSelectionChange}
          />

          {/* Data Summary */}
          {treeData.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Data Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <div className="font-medium">Tournaments</div>
                    <div className="text-2xl font-bold text-primary">{treeData.length}</div>
                  </div>
                  <div>
                    <div className="font-medium">Events</div>
                    <div className="text-2xl font-bold text-blue-600">{cacheStats.events}</div>
                  </div>
                  <div>
                    <div className="font-medium">Markets</div>
                    <div className="text-2xl font-bold text-green-600">{cacheStats.markets}</div>
                  </div>
                  <div>
                    <div className="font-medium">Wager-Eligible</div>
                    <div className="text-2xl font-bold text-orange-600">{wagerEligible}</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right Column: Wager Testing */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Wager Testing</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Selection Display */}
              {activeSel && (
                <div className="p-3 bg-muted rounded-lg">
                  <div className="font-medium text-sm">Selected:</div>
                  <div className="font-bold">{activeSel.displayName}</div>
                  <div className="text-sm text-muted-foreground">
                    {activeSel.marketName} • Event {activeSel.eventId}
                  </div>
                  <div className="text-xs font-mono mt-1">line_id: {activeSel.line_id}</div>
                </div>
              )}

              {/* Wager Composer */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Label htmlFor="odds">Odds</Label>
                  <Button 
                    size="sm" 
                    variant="outline" 
                    onClick={handleOddsToggle}
                    className="text-xs"
                  >
                    {oddsMode === 'american' ? 'American' : 'Decimal'}
                  </Button>
                </div>
                <Input
                  id="odds"
                  value={oddsInput}
                  onChange={(e) => setOddsInput(e.target.value)}
                  placeholder={oddsMode === 'american' ? '150' : '2.50'}
                />
                
                <div>
                  <Label htmlFor="stake">Stake</Label>
                  <Input
                    id="stake"
                    value={stakeInput}
                    onChange={(e) => setStakeInput(e.target.value)}
                    placeholder="10.00"
                    type="number"
                    min="0"
                    step="0.01"
                  />
                </div>

                {/* Helper Text */}
                <div className="text-xs text-muted-foreground">
                  Enter any integer American odds (e.g., +150, -200, +101, -102)
                  <br />
                  Decimal equivalent: {Number.isFinite(decimalToSend) ? decimalToSend.toFixed(4) : 'N/A'}
                </div>

                {wagerError && (
                  <div className="text-xs text-destructive bg-destructive/10 p-2 rounded">
                    {wagerError}
                  </div>
                )}

                <div className="flex gap-2">
                  <Button 
                    onClick={handleTestWager} 
                    disabled={!canPlaceWager || isPlacingWager}
                    className="flex-1"
                  >
                    {isPlacingWager ? 'Placing...' : 'Place Test Wager'}
                  </Button>
                  {lastWagerId && (
                    <Button 
                      onClick={handleTestCancel}
                      variant="outline"
                      size="sm"
                    >
                      Cancel Last
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* My Wagers */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                My Wagers
                <Badge variant="secondary">{wagers.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isWagersLoading && wagers.length === 0 ? (
                <div className="text-center py-4 text-muted-foreground">
                  Loading wagers...
                </div>
              ) : wagers.length === 0 ? (
                <div className="text-center py-4 text-muted-foreground">
                  No wagers found
                </div>
              ) : (
                <div className="max-h-80 overflow-y-auto space-y-2">
                  {wagers.map((wager) => (
                    <div key={wager.wager_id} className="p-3 border rounded-lg text-sm">
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="font-medium">
                            {wager.external_id}
                          </div>
                          <div className="text-muted-foreground">
                            Stake: {wager.stake} • Odds: {wager.odds}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {wager.wager_id} • Line: {wager.line_id}
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <Badge 
                            variant={wager.status === 'open' ? 'default' : 'secondary'}
                          >
                            {wager.status}
                          </Badge>
                          <Badge 
                            variant={
                              wager.matching_status === 'fully_matched' ? 'default' : 
                              wager.matching_status === 'partially_matched' ? 'secondary' : 
                              'outline'
                            }
                          >
                            {wager.matching_status}
                          </Badge>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}