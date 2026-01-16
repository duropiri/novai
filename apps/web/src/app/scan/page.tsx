'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Loader2,
  Smartphone,
  RefreshCw,
  Trash2,
  MoreVertical,
  Download,
  CheckCircle,
  XCircle,
  Plus,
  Camera,
  Sparkles,
  User,
  Users,
  Smile,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/use-toast';
import {
  scanApi,
  ScanSession,
  ScanCapture,
  ANGLE_DISPLAY_NAMES,
} from '@/lib/api';
import { useScanSocket } from '@/lib/scan-socket';
import { QRDisplay, LivePreview, AngleGrid, CaptureGallery } from '@/components/scan';

type ExportTarget = 'lora' | 'character' | 'reference_kit' | 'emotion_board' | null;

export default function ScanPage() {
  // Session state
  const [session, setSession] = useState<ScanSession | null>(null);
  const [captures, setCaptures] = useState<ScanCapture[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [sessionName, setSessionName] = useState('');

  // Connection state
  const [phoneConnected, setPhoneConnected] = useState(false);
  const [currentFrame, setCurrentFrame] = useState<ArrayBuffer | Uint8Array | null>(null);

  // Export dialog
  const [exportTarget, setExportTarget] = useState<ExportTarget>(null);
  const [exporting, setExporting] = useState(false);
  const [exportName, setExportName] = useState('');
  const [exportTriggerWord, setExportTriggerWord] = useState('');
  const [exportSteps, setExportSteps] = useState(1000);
  const [exportLearningRate, setExportLearningRate] = useState(0.0007);
  const [exportIsStyle, setExportIsStyle] = useState(false);
  const { toast } = useToast();

  // Session history
  const [sessions, setSessions] = useState<ScanSession[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);

  // Socket connection
  const {
    connectionState,
    connect,
    disconnect,
    subscribeToSession,
    sendGuideUpdate,
    endSession: socketEndSession,
  } = useScanSocket({
    role: 'desktop',
    events: {
      onPhoneConnected: (sessionId) => {
        console.log('Phone connected to session:', sessionId);
        setPhoneConnected(true);
      },
      onPhoneDisconnected: () => {
        console.log('Phone disconnected');
        setPhoneConnected(false);
        setCurrentFrame(null);
      },
      onFrameReceived: (frameData) => {
        setCurrentFrame(frameData);
      },
      onCaptureReceived: (capture) => {
        console.log('New capture received:', capture);
        setCaptures((prev) => [...prev, capture]);
        // Update session captured angles
        if (session && capture.detected_angle) {
          setSession((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              captured_angles: {
                ...prev.captured_angles,
                [capture.detected_angle!]: {
                  url: capture.image_url,
                  quality: capture.quality_score || 0,
                },
              },
              total_captures: prev.total_captures + 1,
            };
          });
        }
      },
      onError: (error) => {
        console.error('Socket error:', error);
      },
    },
  });

  // Load session history
  const loadHistory = useCallback(async () => {
    try {
      const data = await scanApi.listSessions();
      setSessions(data);
    } catch (error) {
      console.error('Failed to load sessions:', error);
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // Create new session
  const handleCreateSession = async () => {
    setCreating(true);
    try {
      const newSession = await scanApi.createSession({
        name: sessionName || undefined,
      });

      setSession(newSession);
      setCaptures([]);
      setPhoneConnected(false);
      setCurrentFrame(null);
      setSessionName('');

      // Connect to WebSocket and subscribe
      const connected = await connect();
      if (connected) {
        const result = await subscribeToSession(
          newSession.id,
          newSession.session_secret
        );
        if (!result.success) {
          console.error('Failed to subscribe to session:', result.error);
        }
      }

      await loadHistory();
    } catch (error) {
      console.error('Failed to create session:', error);
    } finally {
      setCreating(false);
    }
  };

  // Resume existing session
  const handleResumeSession = async (sessionToResume: ScanSession) => {
    setLoading(true);
    try {
      const { session: sessionData, captures: capturesData } =
        await scanApi.getSession(sessionToResume.id);

      setSession(sessionData);
      setCaptures(capturesData);
      setPhoneConnected(false);
      setCurrentFrame(null);

      // Connect to WebSocket and subscribe
      const connected = await connect();
      if (connected) {
        const result = await subscribeToSession(
          sessionData.id,
          sessionData.session_secret
        );
        if (result.success && result.phoneConnected) {
          setPhoneConnected(true);
        }
      }
    } catch (error) {
      console.error('Failed to resume session:', error);
    } finally {
      setLoading(false);
    }
  };

  // Refresh session (regenerate QR code)
  const handleRefreshSession = async () => {
    if (!session) return;

    // End current session and create new one
    try {
      await scanApi.deleteSession(session.id);
    } catch (error) {
      // Ignore delete errors
    }

    await handleCreateSession();
  };

  // Complete session
  const handleCompleteSession = async () => {
    if (!session) return;

    try {
      await socketEndSession();
      await scanApi.completeSession(session.id);

      // Refresh session data
      const { session: updatedSession, captures: updatedCaptures } =
        await scanApi.getSession(session.id);

      setSession(updatedSession);
      setCaptures(updatedCaptures);
      disconnect();
      await loadHistory();
    } catch (error) {
      console.error('Failed to complete session:', error);
    }
  };

  // Delete session
  const handleDeleteSession = async (sessionId: string) => {
    if (!confirm('Delete this scan session and all its captures?')) return;

    try {
      await scanApi.deleteSession(sessionId);
      if (session?.id === sessionId) {
        setSession(null);
        setCaptures([]);
        disconnect();
      }
      await loadHistory();
    } catch (error) {
      console.error('Failed to delete session:', error);
    }
  };

  // Toggle capture selection
  const handleToggleSelection = async (captureId: string, isSelected: boolean) => {
    try {
      await scanApi.toggleCaptureSelection(captureId, isSelected);
      setCaptures((prev) =>
        prev.map((c) =>
          c.id === captureId ? { ...c, is_selected: isSelected } : c
        )
      );
    } catch (error) {
      console.error('Failed to toggle selection:', error);
    }
  };

  // Delete capture
  const handleDeleteCapture = async (captureId: string) => {
    try {
      await scanApi.deleteCapture(captureId);
      setCaptures((prev) => prev.filter((c) => c.id !== captureId));
    } catch (error) {
      console.error('Failed to delete capture:', error);
    }
  };

  // Get next target angle
  const getNextTargetAngle = (): string | undefined => {
    if (!session) return undefined;
    const captured = new Set(Object.keys(session.captured_angles));
    return session.target_angles.find((angle) => !captured.has(angle));
  };

  // Reset export form when dialog opens
  const openExportDialog = (target: ExportTarget) => {
    setExportTarget(target);
    setExportName(session?.name || '');
    setExportTriggerWord('');
    setExportSteps(1000);
    setExportLearningRate(0.0007);
    setExportIsStyle(false);
  };

  // Handle export
  const handleExport = async () => {
    if (!session || !exportTarget) return;

    if (!exportName.trim()) {
      toast({
        title: 'Name required',
        description: 'Please enter a name for the export',
        variant: 'destructive',
      });
      return;
    }

    if (exportTarget === 'lora' && !exportTriggerWord.trim()) {
      toast({
        title: 'Trigger word required',
        description: 'Please enter a trigger word for the LoRA model',
        variant: 'destructive',
      });
      return;
    }

    setExporting(true);
    try {
      let result: { jobId: string };

      switch (exportTarget) {
        case 'lora':
          result = await scanApi.exportToLora(session.id, {
            name: exportName,
            triggerWord: exportTriggerWord,
            steps: exportSteps,
            learningRate: exportLearningRate,
            isStyle: exportIsStyle,
          });
          toast({
            title: 'LoRA training started',
            description: `Training job started for "${exportName}". Check the LoRA page for progress.`,
          });
          break;
        case 'character':
          result = await scanApi.exportToCharacter(session.id, { name: exportName });
          toast({
            title: 'Character diagram started',
            description: `Creating character diagram "${exportName}". Check the Characters page for progress.`,
          });
          break;
        case 'reference_kit':
          result = await scanApi.exportToReferenceKit(session.id, { name: exportName });
          toast({
            title: 'Reference kit started',
            description: `Creating reference kit "${exportName}". Check the Reference Kits page for progress.`,
          });
          break;
        case 'emotion_board':
          result = await scanApi.exportToEmotionBoard(session.id, { name: exportName });
          toast({
            title: 'Emotion board started',
            description: `Creating emotion board "${exportName}". Check the Emotion Boards page for progress.`,
          });
          break;
      }

      setExportTarget(null);
    } catch (error) {
      console.error('Failed to export:', error);
      toast({
        title: 'Export failed',
        description: error instanceof Error ? error.message : 'Failed to start export',
        variant: 'destructive',
      });
    } finally {
      setExporting(false);
    }
  };

  // Format date
  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Get status badge variant
  const getStatusVariant = (status: string): 'default' | 'secondary' | 'destructive' | 'outline' => {
    switch (status) {
      case 'connected':
      case 'scanning':
        return 'default';
      case 'completed':
        return 'secondary';
      case 'expired':
        return 'destructive';
      default:
        return 'outline';
    }
  };

  const currentTargetAngle = getNextTargetAngle();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Phone Camera Scan</h1>
        <p className="text-muted-foreground">
          Capture face angles from your phone for training data
        </p>
      </div>

      {/* Active Session */}
      {session && session.status !== 'completed' && session.status !== 'expired' ? (
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Left Column: QR + Status */}
          <div className="space-y-4">
            <QRDisplay
              sessionUrl={scanApi.getSessionUrl(session.session_code)}
              sessionCode={session.session_code}
              expiresAt={session.expires_at}
              networkHost={scanApi.getDisplayUrl()}
              onRefresh={handleRefreshSession}
            />

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge variant={getStatusVariant(session.status)}>
                      {session.status}
                    </Badge>
                    {phoneConnected && (
                      <Badge variant="secondary">Phone Connected</Badge>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleCompleteSession}
                      disabled={captures.length === 0}
                    >
                      <CheckCircle className="w-4 h-4 mr-2" />
                      Complete
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDeleteSession(session.id)}
                    >
                      <XCircle className="w-4 h-4 mr-2" />
                      Cancel
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            <AngleGrid
              targetAngles={session.target_angles}
              capturedAngles={session.captured_angles}
              currentAngle={currentTargetAngle}
            />
          </div>

          {/* Center Column: Live Preview */}
          <div className="lg:col-span-2 space-y-4">
            <LivePreview
              frameData={currentFrame}
              isConnected={connectionState === 'connected'}
              phoneConnected={phoneConnected}
              currentAngle={
                currentTargetAngle
                  ? ANGLE_DISPLAY_NAMES[currentTargetAngle]
                  : undefined
              }
            />

            <CaptureGallery
              captures={captures}
              onToggleSelection={handleToggleSelection}
              onDelete={handleDeleteCapture}
            />

            {/* Export Actions */}
            {captures.length > 0 && (
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <span className="text-sm text-muted-foreground">
                      {captures.filter((c) => c.is_selected).length} captures selected
                    </span>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openExportDialog('lora')}
                        disabled={captures.filter((c) => c.is_selected).length < 5}
                      >
                        <Sparkles className="w-4 h-4 mr-2" />
                        LoRA
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openExportDialog('character')}
                        disabled={captures.filter((c) => c.is_selected).length === 0}
                      >
                        <User className="w-4 h-4 mr-2" />
                        Character
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openExportDialog('reference_kit')}
                        disabled={captures.filter((c) => c.is_selected).length < 3}
                      >
                        <Users className="w-4 h-4 mr-2" />
                        Ref Kit
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openExportDialog('emotion_board')}
                        disabled={captures.filter((c) => c.is_selected).length === 0}
                      >
                        <Smile className="w-4 h-4 mr-2" />
                        Emotions
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      ) : (
        /* No Active Session - Show Create Form */
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Camera className="w-5 h-5" />
              Start New Scan Session
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Session Name (Optional)</Label>
              <Input
                value={sessionName}
                onChange={(e) => setSessionName(e.target.value)}
                placeholder="e.g., John's headshots"
              />
            </div>
            <Button onClick={handleCreateSession} disabled={creating}>
              {creating ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Smartphone className="w-4 h-4 mr-2" />
                  Create Scan Session
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Session History */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Scan History</h2>

        {loadingHistory ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center border rounded-lg">
            <Smartphone className="w-12 h-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium">No scan sessions yet</h3>
            <p className="text-muted-foreground mt-1">
              Create your first scan session to get started
            </p>
          </div>
        ) : (
          <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
            {sessions
              .filter((s) => s.id !== session?.id)
              .map((s) => (
                <Card key={s.id} className="relative">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="font-medium truncate">
                          {s.name || `Session ${s.session_code}`}
                        </h3>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge variant={getStatusVariant(s.status)} className="text-xs">
                            {s.status}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {s.total_captures} captures
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          {formatDate(s.created_at)}
                        </p>
                      </div>

                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreVertical className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {s.status !== 'completed' && s.status !== 'expired' && (
                            <DropdownMenuItem onClick={() => handleResumeSession(s)}>
                              <RefreshCw className="w-4 h-4 mr-2" />
                              Resume
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem onClick={() => handleResumeSession(s)}>
                            <Camera className="w-4 h-4 mr-2" />
                            View Captures
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={() => handleDeleteSession(s.id)}
                          >
                            <Trash2 className="w-4 h-4 mr-2" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>

                    {/* Captured angles preview */}
                    {Object.keys(s.captured_angles).length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-3">
                        {Object.entries(s.captured_angles)
                          .slice(0, 4)
                          .map(([angle, data]) => (
                            <img
                              key={angle}
                              src={data.url}
                              alt={angle}
                              className="w-12 h-12 object-cover rounded"
                            />
                          ))}
                        {Object.keys(s.captured_angles).length > 4 && (
                          <div className="w-12 h-12 rounded bg-muted flex items-center justify-center text-sm text-muted-foreground">
                            +{Object.keys(s.captured_angles).length - 4}
                          </div>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
          </div>
        )}
      </div>

      {/* Export Dialog */}
      <Dialog open={!!exportTarget} onOpenChange={() => setExportTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {exportTarget === 'lora'
                ? 'Create LoRA Model'
                : exportTarget === 'character'
                  ? 'Create Character Diagram'
                  : exportTarget === 'reference_kit'
                    ? 'Create Reference Kit'
                    : 'Create Emotion Board'}
            </DialogTitle>
            <DialogDescription>
              {exportTarget === 'lora'
                ? 'Train a LoRA model on your scanned face images.'
                : exportTarget === 'character'
                  ? 'Generate a character diagram from your scan.'
                  : exportTarget === 'reference_kit'
                    ? 'Create a reference kit with multiple angles.'
                    : 'Generate an emotion board with various expressions.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="text-sm text-muted-foreground">
              Using {captures.filter((c) => c.is_selected).length} selected captures
            </div>

            {/* Common: Name field */}
            <div className="space-y-2">
              <Label htmlFor="export-name">Name</Label>
              <Input
                id="export-name"
                value={exportName}
                onChange={(e) => setExportName(e.target.value)}
                placeholder={
                  exportTarget === 'lora'
                    ? 'Model name'
                    : exportTarget === 'character'
                      ? 'Character name'
                      : exportTarget === 'reference_kit'
                        ? 'Kit name'
                        : 'Board name'
                }
              />
            </div>

            {/* LoRA-specific fields */}
            {exportTarget === 'lora' && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="export-trigger">Trigger Word</Label>
                  <Input
                    id="export-trigger"
                    value={exportTriggerWord}
                    onChange={(e) => setExportTriggerWord(e.target.value)}
                    placeholder="e.g., ohwx person"
                  />
                  <p className="text-xs text-muted-foreground">
                    Use this word in prompts to activate the model
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Training Steps</Label>
                    <span className="text-sm text-muted-foreground">{exportSteps}</span>
                  </div>
                  <Slider
                    value={[exportSteps]}
                    onValueChange={([v]) => setExportSteps(v)}
                    min={500}
                    max={2000}
                    step={100}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Style Training</Label>
                    <p className="text-xs text-muted-foreground">
                      Train for style instead of face
                    </p>
                  </div>
                  <Switch
                    checked={exportIsStyle}
                    onCheckedChange={setExportIsStyle}
                  />
                </div>
              </>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setExportTarget(null)}>
              Cancel
            </Button>
            <Button onClick={handleExport} disabled={exporting || !exportName.trim()}>
              {exporting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  {exportTarget === 'lora' && <Sparkles className="w-4 h-4 mr-2" />}
                  {exportTarget === 'character' && <User className="w-4 h-4 mr-2" />}
                  {exportTarget === 'reference_kit' && <Users className="w-4 h-4 mr-2" />}
                  {exportTarget === 'emotion_board' && <Smile className="w-4 h-4 mr-2" />}
                  Create
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
