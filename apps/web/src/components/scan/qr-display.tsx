'use client';

import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Copy, RefreshCw, Smartphone } from 'lucide-react';
import { cn } from '@/lib/utils';

interface QRDisplayProps {
  sessionUrl: string;
  sessionCode: string;
  expiresAt: string;
  onRefresh?: () => void;
  className?: string;
}

export function QRDisplay({
  sessionUrl,
  sessionCode,
  expiresAt,
  onRefresh,
  className,
}: QRDisplayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [copied, setCopied] = useState(false);
  const [timeLeft, setTimeLeft] = useState<string>('');

  // Generate QR code
  useEffect(() => {
    if (canvasRef.current && sessionUrl) {
      QRCode.toCanvas(canvasRef.current, sessionUrl, {
        width: 200,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#ffffff',
        },
      }).catch(console.error);
    }
  }, [sessionUrl]);

  // Update countdown timer
  useEffect(() => {
    const updateTimer = () => {
      const now = new Date();
      const expires = new Date(expiresAt);
      const diff = expires.getTime() - now.getTime();

      if (diff <= 0) {
        setTimeLeft('Expired');
        return;
      }

      const minutes = Math.floor(diff / 60000);
      const seconds = Math.floor((diff % 60000) / 1000);
      setTimeLeft(`${minutes}:${seconds.toString().padStart(2, '0')}`);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(sessionCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy code:', error);
    }
  };

  const isExpired = timeLeft === 'Expired';

  return (
    <Card className={cn('relative', className)}>
      <CardContent className="p-6">
        <div className="flex flex-col items-center space-y-4">
          {/* QR Code */}
          <div className="relative bg-white p-3 rounded-lg">
            <canvas
              ref={canvasRef}
              className={cn('rounded', isExpired && 'opacity-30')}
            />
            {isExpired && (
              <div className="absolute inset-0 flex items-center justify-center">
                <Button variant="outline" onClick={onRefresh}>
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Refresh
                </Button>
              </div>
            )}
          </div>

          {/* Instructions */}
          <div className="text-center space-y-2">
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Smartphone className="w-4 h-4" />
              <span>Scan with your phone camera</span>
            </div>

            {/* Session Code */}
            <div className="flex items-center gap-2">
              <code className="text-lg font-mono font-bold tracking-widest bg-muted px-3 py-1 rounded">
                {sessionCode}
              </code>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleCopyCode}
                className="h-8 w-8"
              >
                <Copy className="w-4 h-4" />
              </Button>
            </div>
            {copied && (
              <p className="text-xs text-green-600">Copied to clipboard!</p>
            )}

            {/* Timer */}
            <p className={cn(
              'text-xs',
              isExpired ? 'text-red-500' : 'text-muted-foreground'
            )}>
              {isExpired ? 'Session expired' : `Expires in ${timeLeft}`}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
