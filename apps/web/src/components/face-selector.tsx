'use client';

import { useState, useCallback } from 'react';
import { User, Users, Scan, Box, CheckCircle2, AlertCircle, Loader2, Camera } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/components/ui/use-toast';

// Types matching the API response
export interface FaceCluster {
  clusterIndex: number;
  faceCount: number;
  matchedIdentity?: {
    id: string;
    name?: string;
    similarity: number;
  };
  detectionIds: string[];
}

export interface FaceIdentity {
  id: string;
  name?: string;
  imageCount: number;
  angleCount: number;
  confidenceScore?: number;
  angleCoverage?: {
    front?: { url: string; quality: number };
    profile_left?: { url: string; quality: number };
    profile_right?: { url: string; quality: number };
    quarter_left?: { url: string; quality: number };
    quarter_right?: { url: string; quality: number };
  };
  meshUrl?: string;
  meshThumbnailUrl?: string;
}

export interface FaceProcessingResult {
  totalFaces: number;
  clusters: FaceCluster[];
  primaryIdentity?: FaceIdentity;
  newIdentities: FaceIdentity[];
  angleCoverage: Record<string, { angle: string; quality: number }[]>;
}

export interface FaceSelectorProps {
  loraId?: string;
  imageUrls: string[];
  onFaceProcessed?: (result: FaceProcessingResult) => void;
  onPrimarySelected?: (identityId: string, clusterIndex: number) => void;
  disabled?: boolean;
  className?: string;
  /** Mode: 'detect' for pre-training detection, 'process' for post-creation processing */
  mode?: 'detect' | 'process';
}

const angleLabels: Record<string, string> = {
  front: 'Front',
  profile_left: 'Left Profile',
  profile_right: 'Right Profile',
  quarter_left: 'Left 3/4',
  quarter_right: 'Right 3/4',
};

export function FaceSelector({
  loraId,
  imageUrls,
  onFaceProcessed,
  onPrimarySelected,
  disabled = false,
  className = '',
  mode = 'detect',
}: FaceSelectorProps) {
  const { toast } = useToast();
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<FaceProcessingResult | null>(null);
  const [selectedClusterIndex, setSelectedClusterIndex] = useState<number>(0);
  const [isGeneratingMesh, setIsGeneratingMesh] = useState(false);

  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

  // Check if any URLs are blob URLs (browser-local, not accessible by server)
  const hasBlobUrls = imageUrls.some((url) => url.startsWith('blob:'));

  // Process images for face detection
  const processFaces = useCallback(async () => {
    if (imageUrls.length === 0) {
      toast({
        title: 'Error',
        description: 'No images to process',
        variant: 'destructive',
      });
      return;
    }

    // Check for blob URLs - these can't be accessed by the server
    if (hasBlobUrls) {
      toast({
        title: 'Images Not Uploaded',
        description: 'Face detection requires uploaded images. Start training first, then detect faces.',
        variant: 'destructive',
      });
      return;
    }

    setIsProcessing(true);
    try {
      let data: FaceProcessingResult;

      if (mode === 'process' && loraId) {
        // Full processing mode - requires loraId
        const response = await fetch(`${API_URL}/lora/${loraId}/faces/process`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageUrls }),
        });

        if (!response.ok) {
          throw new Error('Failed to process faces');
        }

        data = await response.json();
      } else {
        // Standalone detection mode - no loraId needed
        const response = await fetch(`${API_URL}/faces/detect`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageUrls }),
        });

        if (!response.ok) {
          throw new Error('Failed to detect faces');
        }

        const detectResult = await response.json();

        // Transform detection result to FaceProcessingResult format
        // Group detections by identity match
        const clusters: FaceCluster[] = [];
        const matchGroups = new Map<string, typeof detectResult.identityMatches>();

        // Group by matched identity
        for (const match of detectResult.identityMatches || []) {
          const bestMatch = match.matches?.[0];
          if (bestMatch?.isMatch) {
            const existing = matchGroups.get(bestMatch.identityId) || [];
            existing.push(match);
            matchGroups.set(bestMatch.identityId, existing);
          }
        }

        // Create clusters from groups
        let clusterIndex = 0;
        for (const [identityId, matches] of matchGroups.entries()) {
          const firstMatch = matches[0].matches?.[0];
          clusters.push({
            clusterIndex: clusterIndex++,
            faceCount: matches.length,
            matchedIdentity: firstMatch ? {
              id: firstMatch.identityId,
              name: firstMatch.identityName,
              similarity: firstMatch.similarity,
            } : undefined,
            detectionIds: matches.map((m: any) => m.detection?.id || ''),
          });
        }

        // Add unmatched detections as a single cluster
        const unmatchedCount = (detectResult.detections?.length || 0) -
          (detectResult.identityMatches?.filter((m: any) => m.matches?.[0]?.isMatch).length || 0);
        if (unmatchedCount > 0 || clusters.length === 0) {
          clusters.push({
            clusterIndex: clusterIndex,
            faceCount: unmatchedCount || detectResult.detections?.length || 0,
            detectionIds: [],
          });
        }

        data = {
          totalFaces: detectResult.detections?.length || 0,
          clusters,
          newIdentities: [],
          angleCoverage: {},
        };
      }

      setResult(data);

      // Auto-select first cluster
      if (data.clusters.length > 0) {
        setSelectedClusterIndex(0);
        const firstCluster = data.clusters[0];
        onPrimarySelected?.(firstCluster.matchedIdentity?.id || '', 0);
      }

      onFaceProcessed?.(data);

      toast({
        title: 'Face Detection Complete',
        description: `Found ${data.totalFaces} face(s) in ${data.clusters.length} identity group(s)`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to process faces';
      toast({ title: 'Error', description: message, variant: 'destructive' });
    } finally {
      setIsProcessing(false);
    }
  }, [mode, loraId, imageUrls, hasBlobUrls, API_URL, onFaceProcessed, onPrimarySelected, toast]);

  // Set primary identity/cluster
  const selectCluster = useCallback(async (clusterIndex: number) => {
    setSelectedClusterIndex(clusterIndex);

    const cluster = result?.clusters[clusterIndex];
    if (!cluster) return;

    // In detect mode, just update local state and notify parent
    if (mode === 'detect' || !loraId) {
      onPrimarySelected?.(cluster.matchedIdentity?.id || '', clusterIndex);
      toast({
        title: 'Primary Selected',
        description: 'This identity group will be used for training',
      });
      return;
    }

    // In process mode, also update via API
    try {
      if (cluster.matchedIdentity?.id) {
        const response = await fetch(`${API_URL}/lora/${loraId}/faces/primary`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ identityId: cluster.matchedIdentity.id }),
        });

        if (!response.ok) {
          throw new Error('Failed to set primary identity');
        }
      }

      onPrimarySelected?.(cluster.matchedIdentity?.id || '', clusterIndex);

      toast({
        title: 'Primary Identity Set',
        description: 'This identity will be used for training',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to set primary';
      toast({ title: 'Error', description: message, variant: 'destructive' });
    }
  }, [mode, loraId, result, API_URL, onPrimarySelected, toast]);

  // Generate 3D mesh for identity (only available in process mode with loraId)
  const generateMesh = useCallback(async () => {
    if (!loraId || mode !== 'process') return;

    setIsGeneratingMesh(true);
    try {
      const response = await fetch(`${API_URL}/lora/${loraId}/faces/mesh`, {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error('Failed to generate mesh');
      }

      const data = await response.json();

      if (data.skipped) {
        toast({
          title: 'Mesh Generation Skipped',
          description: data.reason || 'Not enough angle coverage',
        });
      } else {
        toast({
          title: '3D Face Mesh Generated',
          description: 'Skull geometry vectors extracted for accurate generation',
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to generate mesh';
      toast({ title: 'Error', description: message, variant: 'destructive' });
    } finally {
      setIsGeneratingMesh(false);
    }
  }, [loraId, mode, API_URL, toast]);

  // Calculate angle coverage percentage
  const getAngleCoveragePercent = (identity: FaceIdentity): number => {
    if (!identity.angleCoverage) return 0;
    const covered = Object.values(identity.angleCoverage).filter(Boolean).length;
    return Math.round((covered / 5) * 100);
  };

  // Get missing angles for suggestions
  const getMissingAngles = (identity: FaceIdentity): string[] => {
    const coverage = identity.angleCoverage || {};
    const missing: string[] = [];

    if (!coverage.front) missing.push('Front');
    if (!coverage.profile_left && !coverage.profile_right) missing.push('Profile');
    if (!coverage.quarter_left && !coverage.quarter_right) missing.push('3/4 Angle');

    return missing;
  };

  // Check if ready for 3D mesh
  const isReadyFor3D = (identity: FaceIdentity): boolean => {
    const coverage = identity.angleCoverage || {};
    const hasFront = !!coverage.front;
    const hasProfile = !!coverage.profile_left || !!coverage.profile_right;
    return hasFront && hasProfile;
  };

  // Render cluster card
  const renderClusterCard = (cluster: FaceCluster, index: number) => {
    const isSelected = selectedClusterIndex === index;
    const hasIdentity = !!cluster.matchedIdentity;
    const name = cluster.matchedIdentity?.name ||
      (hasIdentity ? `Identity ${cluster.matchedIdentity?.id.slice(0, 8)}` : `New Face Group ${index + 1}`);

    return (
      <Card
        key={`cluster-${index}`}
        className={`cursor-pointer transition-all ${
          isSelected
            ? 'border-primary ring-2 ring-primary/30'
            : 'hover:border-primary/50'
        }`}
        onClick={() => selectCluster(index)}
      >
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <User className="w-4 h-4" />
              {name}
            </CardTitle>
            {isSelected && (
              <Badge variant="default" className="text-xs">
                <CheckCircle2 className="w-3 h-3 mr-1" />
                Primary
              </Badge>
            )}
            {!hasIdentity && (
              <Badge variant="secondary" className="text-xs">New</Badge>
            )}
          </div>
          <CardDescription className="text-xs">
            {cluster.faceCount} face{cluster.faceCount !== 1 ? 's' : ''} detected
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {/* Match confidence for known identities */}
          {cluster.matchedIdentity && (
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Match confidence</span>
              <span className="font-medium">
                {Math.round(cluster.matchedIdentity.similarity * 100)}%
              </span>
            </div>
          )}

          {/* Face count info */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Users className="w-3.5 h-3.5" />
            <span>
              {hasIdentity
                ? 'Recognized identity from previous training'
                : 'New identity not seen before'}
            </span>
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Scan className="w-5 h-5" />
          <span className="font-medium">HiRA Face Detection</span>
        </div>
        <Button
          onClick={processFaces}
          disabled={disabled || isProcessing || imageUrls.length === 0 || hasBlobUrls}
          size="sm"
          title={hasBlobUrls ? 'Upload images first to enable face detection' : undefined}
        >
          {isProcessing ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Detecting Faces...
            </>
          ) : hasBlobUrls ? (
            <>
              <AlertCircle className="w-4 h-4 mr-2" />
              Upload First
            </>
          ) : (
            <>
              <Camera className="w-4 h-4 mr-2" />
              Detect Faces
            </>
          )}
        </Button>
      </div>

      {/* Results */}
      {result && (
        <div className="space-y-4">
          {/* Summary */}
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              <User className="w-4 h-4" />
              {result.totalFaces} face{result.totalFaces !== 1 ? 's' : ''} detected
            </span>
            <span className="flex items-center gap-1">
              <Users className="w-4 h-4" />
              {result.clusters.length} identity group{result.clusters.length !== 1 ? 's' : ''}
            </span>
          </div>

          {/* Instructions */}
          <p className="text-sm text-muted-foreground">
            Select the primary identity for training. This face will be the focus of the LoRA model.
          </p>

          {/* Cluster cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {result.clusters.map((cluster, index) => renderClusterCard(cluster, index))}
          </div>

          {/* 3D Mesh Generation - Only show in process mode with loraId */}
          {mode === 'process' && loraId && result.clusters.length > 0 && (
            <div className="pt-2 border-t">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <p className="text-sm font-medium">3D Face Geometry</p>
                  <p className="text-xs text-muted-foreground">
                    Generate 3D skull vectors for accurate face reproduction
                  </p>
                </div>
                <Button
                  onClick={generateMesh}
                  disabled={isGeneratingMesh}
                  variant="outline"
                  size="sm"
                >
                  {isGeneratingMesh ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Box className="w-4 h-4 mr-2" />
                      Generate 3D Mesh
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {!result && !isProcessing && (
        <div className="text-center py-6 text-muted-foreground border rounded-lg border-dashed">
          <Scan className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">Upload images and detect faces to identify people</p>
          <p className="text-xs mt-1">
            HiRA will group faces by identity and help you select the primary subject
          </p>
        </div>
      )}
    </div>
  );
}

export default FaceSelector;
