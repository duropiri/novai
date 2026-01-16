'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Loader2,
  Smile,
  Upload,
  Trash2,
  MoreVertical,
  Download,
  ExternalLink,
  Image as ImageIcon,
  User,
  Users,
  Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  emotionBoardApi,
  loraApi,
  characterApi,
  referenceKitApi,
  filesApi,
  type EmotionBoard,
  type LoraModel,
  type CharacterDiagram,
  type ReferenceKit,
  STANDARD_EMOTIONS,
  EXTENDED_EMOTIONS,
} from '@/lib/api';

type SourceType = 'image' | 'lora' | 'character' | 'reference_kit';
type GridSize = '2x4' | '2x8';

export default function EmotionBoardPage() {
  // Form state
  const [sourceType, setSourceType] = useState<SourceType>('image');
  const [sourceImageUrl, setSourceImageUrl] = useState<string>('');
  const [selectedLoraId, setSelectedLoraId] = useState<string>('');
  const [selectedCharacterId, setSelectedCharacterId] = useState<string>('');
  const [selectedKitId, setSelectedKitId] = useState<string>('');
  const [gridSize, setGridSize] = useState<GridSize>('2x4');
  const [boardName, setBoardName] = useState<string>('');
  const [uploading, setUploading] = useState(false);
  const [creating, setCreating] = useState(false);

  // Data state
  const [boards, setBoards] = useState<EmotionBoard[]>([]);
  const [loras, setLoras] = useState<LoraModel[]>([]);
  const [characters, setCharacters] = useState<CharacterDiagram[]>([]);
  const [kits, setKits] = useState<ReferenceKit[]>([]);
  const [loading, setLoading] = useState(true);

  // Preview state
  const [previewBoard, setPreviewBoard] = useState<EmotionBoard | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  // Load data
  const loadData = useCallback(async () => {
    try {
      const [boardsData, lorasData, charactersData, kitsData] = await Promise.all([
        emotionBoardApi.list(),
        loraApi.list('ready'),
        characterApi.list('ready'),
        referenceKitApi.list('ready'),
      ]);
      setBoards(boardsData);
      setLoras(lorasData);
      setCharacters(charactersData);
      setKits(kitsData);
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    // Poll for updates every 5 seconds
    const interval = setInterval(loadData, 5000);
    return () => clearInterval(interval);
  }, [loadData]);

  // Handle image upload
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const result = await filesApi.uploadImage(file);
      setSourceImageUrl(result.url);
    } catch (error) {
      console.error('Failed to upload image:', error);
    } finally {
      setUploading(false);
    }
  };

  // Create emotion board
  const handleCreate = async () => {
    if (!canCreate()) return;

    setCreating(true);
    try {
      await emotionBoardApi.create({
        name: boardName || undefined,
        sourceType,
        sourceImageUrl: sourceType === 'image' ? sourceImageUrl : undefined,
        loraId: sourceType === 'lora' ? selectedLoraId : undefined,
        characterDiagramId: sourceType === 'character' ? selectedCharacterId : undefined,
        referenceKitId: sourceType === 'reference_kit' ? selectedKitId : undefined,
        gridSize,
      });

      // Reset form
      setBoardName('');
      setSourceImageUrl('');
      setSelectedLoraId('');
      setSelectedCharacterId('');
      setSelectedKitId('');

      // Reload boards
      await loadData();
    } catch (error) {
      console.error('Failed to create emotion board:', error);
    } finally {
      setCreating(false);
    }
  };

  // Delete emotion board
  const handleDelete = async (id: string) => {
    if (!confirm('Delete this emotion board?')) return;

    try {
      await emotionBoardApi.delete(id);
      await loadData();
    } catch (error) {
      console.error('Failed to delete emotion board:', error);
    }
  };

  // Check if can create
  const canCreate = () => {
    switch (sourceType) {
      case 'image':
        return !!sourceImageUrl;
      case 'lora':
        return !!selectedLoraId;
      case 'character':
        return !!selectedCharacterId;
      case 'reference_kit':
        return !!selectedKitId;
      default:
        return false;
    }
  };

  // Get estimated cost
  const getEstimatedCost = () => {
    const emotions = gridSize === '2x4' ? 8 : 16;
    const costPerCell = 3; // cents
    return (emotions * costPerCell / 100).toFixed(2);
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

  // Get status color
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'ready':
        return 'text-green-500';
      case 'generating':
        return 'text-yellow-500';
      case 'failed':
        return 'text-red-500';
      default:
        return 'text-muted-foreground';
    }
  };

  // Get source icon
  const getSourceIcon = (type: string) => {
    switch (type) {
      case 'lora':
        return <Sparkles className="h-4 w-4" />;
      case 'character':
        return <User className="h-4 w-4" />;
      case 'reference_kit':
        return <Users className="h-4 w-4" />;
      default:
        return <ImageIcon className="h-4 w-4" />;
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Emotion Boards</h1>
        <p className="text-muted-foreground">
          Generate expression sheets with multiple emotions from any identity source
        </p>
      </div>

      {/* Create Form */}
      <div className="rounded-lg border bg-card p-6">
        <h2 className="text-lg font-semibold mb-4">Create Emotion Board</h2>

        {/* Identity Source */}
        <div className="space-y-4">
          <div>
            <Label>Identity Source</Label>
            <Tabs value={sourceType} onValueChange={(v) => setSourceType(v as SourceType)} className="mt-2">
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="image">
                  <ImageIcon className="h-4 w-4 mr-2" />
                  Image
                </TabsTrigger>
                <TabsTrigger value="lora">
                  <Sparkles className="h-4 w-4 mr-2" />
                  LoRA
                </TabsTrigger>
                <TabsTrigger value="character">
                  <User className="h-4 w-4 mr-2" />
                  Character
                </TabsTrigger>
                <TabsTrigger value="reference_kit">
                  <Users className="h-4 w-4 mr-2" />
                  Kit
                </TabsTrigger>
              </TabsList>

              <TabsContent value="image" className="mt-4">
                <div className="space-y-2">
                  <Label>Upload Face Image</Label>
                  {sourceImageUrl ? (
                    <div className="relative w-32 h-32">
                      <img
                        src={sourceImageUrl}
                        alt="Source"
                        className="w-full h-full object-cover rounded-lg"
                      />
                      <Button
                        variant="destructive"
                        size="icon"
                        className="absolute -top-2 -right-2 h-6 w-6"
                        onClick={() => setSourceImageUrl('')}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  ) : (
                    <label className="flex items-center justify-center w-32 h-32 border-2 border-dashed rounded-lg cursor-pointer hover:border-primary transition-colors">
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handleImageUpload}
                        disabled={uploading}
                      />
                      {uploading ? (
                        <Loader2 className="h-6 w-6 animate-spin" />
                      ) : (
                        <Upload className="h-6 w-6 text-muted-foreground" />
                      )}
                    </label>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="lora" className="mt-4">
                <div className="space-y-2">
                  <Label>Select LoRA Model</Label>
                  <Select value={selectedLoraId} onValueChange={setSelectedLoraId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose a LoRA..." />
                    </SelectTrigger>
                    <SelectContent>
                      {loras.map((lora) => (
                        <SelectItem key={lora.id} value={lora.id}>
                          {lora.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {loras.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      No ready LoRA models available
                    </p>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="character" className="mt-4">
                <div className="space-y-2">
                  <Label>Select Character Diagram</Label>
                  <Select value={selectedCharacterId} onValueChange={setSelectedCharacterId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose a character..." />
                    </SelectTrigger>
                    <SelectContent>
                      {characters.map((char) => (
                        <SelectItem key={char.id} value={char.id}>
                          {char.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {characters.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      No ready character diagrams available
                    </p>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="reference_kit" className="mt-4">
                <div className="space-y-2">
                  <Label>Select Reference Kit</Label>
                  <Select value={selectedKitId} onValueChange={setSelectedKitId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose a reference kit..." />
                    </SelectTrigger>
                    <SelectContent>
                      {kits.map((kit) => (
                        <SelectItem key={kit.id} value={kit.id}>
                          {kit.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {kits.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      No ready reference kits available
                    </p>
                  )}
                </div>
              </TabsContent>
            </Tabs>
          </div>

          {/* Grid Size */}
          <div>
            <Label>Grid Size</Label>
            <RadioGroup
              value={gridSize}
              onValueChange={(v) => setGridSize(v as GridSize)}
              className="flex gap-4 mt-2"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="2x4" id="grid-2x4" />
                <Label htmlFor="grid-2x4" className="font-normal cursor-pointer">
                  2x4 (8 emotions)
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="2x8" id="grid-2x8" />
                <Label htmlFor="grid-2x8" className="font-normal cursor-pointer">
                  2x8 (16 emotions)
                </Label>
              </div>
            </RadioGroup>
          </div>

          {/* Board Name (Optional) */}
          <div>
            <Label>Name (Optional)</Label>
            <Input
              value={boardName}
              onChange={(e) => setBoardName(e.target.value)}
              placeholder="My emotion board"
              className="mt-1"
            />
          </div>

          {/* Emotions Preview */}
          <div>
            <Label>Emotions</Label>
            <div className="flex flex-wrap gap-2 mt-2">
              {(gridSize === '2x4' ? STANDARD_EMOTIONS : EXTENDED_EMOTIONS).map((emotion) => (
                <span
                  key={emotion}
                  className="px-2 py-1 text-xs bg-muted rounded-md"
                >
                  {emotion}
                </span>
              ))}
            </div>
          </div>

          {/* Cost & Create */}
          <div className="flex items-center justify-between pt-4 border-t">
            <div className="text-sm text-muted-foreground">
              Estimated cost: <span className="font-medium">${getEstimatedCost()}</span>
            </div>
            <Button onClick={handleCreate} disabled={!canCreate() || creating}>
              {creating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Creating...
                </>
              ) : (
                <>
                  <Smile className="h-4 w-4 mr-2" />
                  Generate Emotion Board
                </>
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* Boards Gallery */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Your Emotion Boards</h2>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : boards.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center border rounded-lg">
            <Smile className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium">No emotion boards yet</h3>
            <p className="text-muted-foreground mt-1">
              Create your first emotion board using the form above
            </p>
          </div>
        ) : (
          <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
            {boards.map((board) => (
              <div
                key={board.id}
                className="group relative rounded-lg border bg-card overflow-hidden hover:shadow-md transition-shadow"
              >
                {/* Thumbnail */}
                <div
                  className="aspect-[4/3] bg-muted cursor-pointer"
                  onClick={() => {
                    if (board.status === 'ready' && board.board_url) {
                      setPreviewBoard(board);
                      setPreviewOpen(true);
                    }
                  }}
                >
                  {board.board_url ? (
                    <img
                      src={board.board_url}
                      alt={board.name || 'Emotion Board'}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      {board.status === 'generating' ? (
                        <div className="text-center">
                          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2" />
                          <p className="text-sm text-muted-foreground">
                            {board.progress}%
                          </p>
                        </div>
                      ) : board.status === 'failed' ? (
                        <div className="text-center px-4">
                          <p className="text-sm text-destructive">
                            {board.error_message || 'Generation failed'}
                          </p>
                        </div>
                      ) : (
                        <Smile className="h-12 w-12 text-muted-foreground" />
                      )}
                    </div>
                  )}
                </div>

                {/* Info */}
                <div className="p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-medium truncate">
                        {board.name || `Board ${board.id.slice(0, 8)}`}
                      </h3>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
                        {getSourceIcon(board.source_type)}
                        <span>{board.grid_size}</span>
                        <span className={getStatusColor(board.status)}>
                          {board.status}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {formatDate(board.created_at)}
                      </p>
                    </div>

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {board.board_url && (
                          <>
                            <DropdownMenuItem asChild>
                              <a href={board.board_url} target="_blank" rel="noopener noreferrer">
                                <ExternalLink className="h-4 w-4 mr-2" />
                                Open Full Size
                              </a>
                            </DropdownMenuItem>
                            <DropdownMenuItem asChild>
                              <a href={board.board_url} download>
                                <Download className="h-4 w-4 mr-2" />
                                Download
                              </a>
                            </DropdownMenuItem>
                          </>
                        )}
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={() => handleDelete(board.id)}
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Preview Dialog */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{previewBoard?.name || 'Emotion Board'}</DialogTitle>
            <DialogDescription>
              {previewBoard?.grid_size} grid with {previewBoard?.emotions.length} emotions
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-center bg-muted rounded-lg overflow-hidden">
            {previewBoard?.board_url && (
              <img
                src={previewBoard.board_url}
                alt={previewBoard.name || 'Emotion Board'}
                className="max-h-[70vh] object-contain"
              />
            )}
          </div>
          <div className="flex justify-end gap-2">
            {previewBoard?.board_url && (
              <>
                <Button variant="outline" asChild>
                  <a href={previewBoard.board_url} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-4 w-4 mr-2" />
                    Open Full Size
                  </a>
                </Button>
                <Button asChild>
                  <a href={previewBoard.board_url} download>
                    <Download className="h-4 w-4 mr-2" />
                    Download
                  </a>
                </Button>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
