import { useState } from 'react';
import { TreeNode } from '@/services/prophetx-api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ChevronRight, ChevronDown, TrendingUp, Clock, DollarSign, Activity } from 'lucide-react';

interface DataTreeViewProps {
  data: TreeNode[];
  onLoadData: () => void;
  isLoading: boolean;
  isAuthenticated: boolean;
}

interface TreeItemProps {
  node: TreeNode;
  level: number;
}

const TreeItem = ({ node, level }: TreeItemProps) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const hasChildren = node.children && node.children.length > 0;

  const getIcon = () => {
    switch (node.type) {
      case 'sport':
        return <Activity className="h-4 w-4 text-primary" />;
      case 'event':
        return <Clock className="h-4 w-4 text-blue-600" />;
      case 'category':
        return <TrendingUp className="h-4 w-4 text-purple-600" />;
      case 'market':
        return <DollarSign className="h-4 w-4 text-green-600" />;
      case 'selection':
        return <div className="h-4 w-4 rounded-full bg-orange-500" />;
      default:
        return null;
    }
  };

  const formatStartTime = (startTime: string) => {
    try {
      return new Date(startTime).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short'
      });
    } catch {
      return startTime;
    }
  };

  const renderNodeContent = () => {
    return (
      <div className="flex items-center space-x-2 flex-1">
        {getIcon()}
        <span className="font-medium">{node.name}</span>
        
        {node.type === 'event' && node.data?.startTime && (
          <Badge variant="outline" className="ml-2 text-xs">
            {formatStartTime(node.data.startTime)}
          </Badge>
        )}
        
        {node.type === 'market' && node.data?.state && (
          <Badge 
            variant={node.data.state === 'OPEN' ? 'default' : 'secondary'}
            className="ml-2 text-xs"
          >
            {node.data.state}
          </Badge>
        )}
        
        {node.type === 'selection' && node.data && (
          <div className="flex items-center space-x-2 ml-auto">
            {node.data.oddsDecimal && (
              <Badge variant="outline" className="text-xs">
                {node.data.oddsDecimal.toFixed(2)}
              </Badge>
            )}
            {node.data.availableLiquidity !== undefined && (
              <Badge variant="secondary" className="text-xs">
                Liq: ${node.data.availableLiquidity}
              </Badge>
            )}
          </div>
        )}
        
        {hasChildren && (
          <div className="ml-auto">
            {isExpanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="w-full">
      <div
        className={`flex items-center py-2 px-3 hover:bg-muted/50 cursor-pointer rounded-md transition-colors ${
          level > 0 ? 'ml-' + (level * 4) : ''
        }`}
        style={{ marginLeft: `${level * 20}px` }}
        onClick={() => hasChildren && setIsExpanded(!isExpanded)}
      >
        {renderNodeContent()}
      </div>
      
      {hasChildren && isExpanded && (
        <div className="space-y-1">
          {node.children!.map((child) => (
            <TreeItem key={child.id} node={child} level={level + 1} />
          ))}
        </div>
      )}
    </div>
  );
};

export const DataTreeView = ({ data, onLoadData, isLoading, isAuthenticated }: DataTreeViewProps) => {
  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center space-x-2">
            <Activity className="h-5 w-5" />
            <span>ProphetX Market Data</span>
          </CardTitle>
          <Button 
            onClick={onLoadData} 
            disabled={!isAuthenticated || isLoading}
            variant="outline"
          >
            {isLoading ? 'Loading...' : 'Load Data'}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {!isAuthenticated ? (
          <div className="text-center py-8 text-muted-foreground">
            Please authenticate first to load market data
          </div>
        ) : data.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            Click "Load Data" to fetch the market hierarchy
          </div>
        ) : (
          <div className="space-y-1 max-h-96 overflow-y-auto border rounded-md p-2">
            {data.map((node) => (
              <TreeItem key={node.id} node={node} level={0} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};