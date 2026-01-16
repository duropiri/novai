'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
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
  Upload,
  Trash2,
  MoreVertical,
  Download,
  ExternalLink,
  XCircle,
  Image as ImageIcon,
  User,
  Users,
  Sparkles,
  Palette,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  expressionBoardApi,
  loraApi,
  characterApi,
  referenceKitApi,
  filesApi,
  type ExpressionBoard,
  type LoraModel,
  type CharacterDiagram,
  type ReferenceKit,
  type BoardType,
  BOARD_TYPES,
  BOARD_TYPE_LABELS,
  BOARD_EXPRESSIONS,
} from '@/lib/api';

type SourceType = 'image' | 'lora' | 'character' | 'reference_kit';

export default function ExpressionBoardPage() {
  // Form state
  const [sourceType, setSourceType] = useState<SourceType>('image');
  const [sourceImageUrl, setSourceImageUrl] = useState<string>('');
  const [selectedLoraId, setSelectedLoraId] = useState<string>('');
  const [selectedCharacterId, setSelectedCharacterId] = useState<string>('');
  const [selectedKitId, setSelectedKitId] = useState<string>('');
  const [selectedBoardTypes, setSelectedBoardTypes] = useState<BoardType[]>([...BOARD_TYPES]);
  const [boardName, setBoardName] = useState<string>('');
  const [uploading, setUploading] = useState(false);
  const [creating, setCreating] = useState(false);

  // Data state
  const [boards, setBoards] = useState<ExpressionBoard[]>([]);
  const [loras, setLoras] = useState<LoraModel[]>([]);
  const [characters, setCharacters] = useState<CharacterDiagram[]>([]);
  const [kits, setKits] = useState<ReferenceKit[]>([]);
  const [loading, setLoading] = useState(true);

  // Preview state
  const [previewBoard, setPreviewBoard] = useState<ExpressionBoard | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  // Load data
  const loadData = useCallback(async () => {
    try {
      const [boardsData, lorasData, charactersData, kitsData] = await Promise.all([
        expressionBoardApi.list(),
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

  // Toggle board type
  const toggleBoardType = (boardType: BoardType) => {
    setSelectedBoardTypes(prev => {
      if (prev.includes(boardType)) {
        // Don't allow deselecting all
        if (prev.length === 1) return prev;
        return prev.filter(t => t !== boardType);
      } else {
        return [...prev, boardType];
      }
    });
  };

  // Select all board types
  const selectAllBoardTypes = () => {
    setSelectedBoardTypes([...BOARD_TYPES]);
  };

  // Create expression board
  const handleCreate = async () => {
    if (!canCreate()) return;

    setCreating(true);
    try {
      await expressionBoardApi.create({
        name: boardName || undefined,
        sourceType,
        sourceImageUrl: sourceType === 'image' ? sourceImageUrl : undefined,
        loraId: sourceType === 'lora' ? selectedLoraId : undefined,
        characterDiagramId: sourceType === 'character' ? selectedCharacterId : undefined,
        referenceKitId: sourceType === 'reference_kit' ? selectedKitId : undefined,
        boardTypes: selectedBoardTypes,
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
      console.error('Failed to create expression board:', error);
    } finally {
      setCreating(false);
    }
  };

  // Delete expression board
  const handleDelete = async (id: string) => {
    if (!confirm('Delete this expression board?')) return;

    try {
      await expressionBoardApi.delete(id);
      await loadData();
    } catch (error) {
      console.error('Failed to delete expression board:', error);
    }
  };

  // Cancel expression board generation
  const handleCancel = async (id: string) => {
    if (!confirm('Cancel this expression board generation?')) return;

    try {
      await expressionBoardApi.cancel(id);
      await loadData();
    } catch (error) {
      console.error('Failed to cancel expression board:', error);
    }
  };

  // Check if can create
  const canCreate = () => {
    if (selectedBoardTypes.length === 0) return false;
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

  // Get total expressions count
  const getTotalExpressions = () => {
    return selectedBoardTypes.reduce((sum, type) => sum + BOARD_EXPRESSIONS[type].length, 0);
  };

  // Get estimated cost
  const getEstimatedCost = () => {
    const total = getTotalExpressions();
    const costPerExpression = 2; // cents
    return (total * costPerExpression / 100).toFixed(2);
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
        <h1 className="text-2xl font-bold">Expression Boards</h1>
        <p className="text-muted-foreground">
          Generate comprehensive expression sheets with 40 expressions across 5 categories
        </p>
      </div>

      {/* Create Form */}
      <div className="rounded-lg border bg-card p-6">
        <h2 className="text-lg font-semibold mb-4">Create Expression Board</h2>

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
                  {loras.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No ready LoRA models available
                    </p>
                  ) : (
                    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2 max-h-48 overflow-y-auto p-1">
                      {loras.map((lora) => (
                        <div
                          key={lora.id}
                          className={cn(
                            'relative cursor-pointer rounded-lg overflow-hidden border-2 transition-all',
                            selectedLoraId === lora.id
                              ? 'border-primary ring-2 ring-primary/20'
                              : 'border-transparent hover:border-muted-foreground/30'
                          )}
                          onClick={() => setSelectedLoraId(lora.id)}
                        >
                          <div className="aspect-square bg-muted">
                            {lora.thumbnail_url ? (
                              <img
                                src={lora.thumbnail_url}
                                alt={lora.name}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <Sparkles className="h-6 w-6 text-muted-foreground" />
                              </div>
                            )}
                          </div>
                          <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-1 py-0.5">
                            <p className="text-xs text-white truncate">{lora.name}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="character" className="mt-4">
                <div className="space-y-2">
                  <Label>Select Character Diagram</Label>
                  {characters.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No ready character diagrams available
                    </p>
                  ) : (
                    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2 max-h-48 overflow-y-auto p-1">
                      {characters.map((char) => (
                        <div
                          key={char.id}
                          className={cn(
                            'relative cursor-pointer rounded-lg overflow-hidden border-2 transition-all',
                            selectedCharacterId === char.id
                              ? 'border-primary ring-2 ring-primary/20'
                              : 'border-transparent hover:border-muted-foreground/30'
                          )}
                          onClick={() => setSelectedCharacterId(char.id)}
                        >
                          <div className="aspect-square bg-muted">
                            {char.primary_image_url || char.source_image_url ? (
                              <img
                                src={char.primary_image_url || char.source_image_url || ''}
                                alt={char.name}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <User className="h-6 w-6 text-muted-foreground" />
                              </div>
                            )}
                          </div>
                          <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-1 py-0.5">
                            <p className="text-xs text-white truncate">{char.name}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="reference_kit" className="mt-4">
                <div className="space-y-2">
                  <Label>Select Reference Kit</Label>
                  {kits.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No ready reference kits available
                    </p>
                  ) : (
                    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2 max-h-48 overflow-y-auto p-1">
                      {kits.map((kit) => (
                        <div
                          key={kit.id}
                          className={cn(
                            'relative cursor-pointer rounded-lg overflow-hidden border-2 transition-all',
                            selectedKitId === kit.id
                              ? 'border-primary ring-2 ring-primary/20'
                              : 'border-transparent hover:border-muted-foreground/30'
                          )}
                          onClick={() => setSelectedKitId(kit.id)}
                        >
                          <div className="aspect-square bg-muted">
                            {kit.anchor_face_url || kit.source_image_url ? (
                              <img
                                src={kit.anchor_face_url || kit.source_image_url}
                                alt={kit.name}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <Users className="h-6 w-6 text-muted-foreground" />
                              </div>
                            )}
                          </div>
                          <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-1 py-0.5">
                            <p className="text-xs text-white truncate">{kit.name}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </TabsContent>
            </Tabs>
          </div>

          {/* Board Types Selection */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label>Expression Categories</Label>
              <Button
                variant="ghost"
                size="sm"
                onClick={selectAllBoardTypes}
                className="text-xs h-7"
              >
                Select All
              </Button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {BOARD_TYPES.map((boardType) => (
                <div
                  key={boardType}
                  className={cn(
                    'flex items-center space-x-2 p-3 rounded-lg border cursor-pointer transition-colors',
                    selectedBoardTypes.includes(boardType)
                      ? 'bg-primary/10 border-primary'
                      : 'hover:bg-muted'
                  )}
                  onClick={() => toggleBoardType(boardType)}
                >
                  <Checkbox
                    checked={selectedBoardTypes.includes(boardType)}
                    onCheckedChange={() => toggleBoardType(boardType)}
                  />
                  <div className="flex-1">
                    <p className="text-sm font-medium">{BOARD_TYPE_LABELS[boardType]}</p>
                    <p className="text-xs text-muted-foreground">
                      {BOARD_EXPRESSIONS[boardType].length} expressions
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Board Name (Optional) */}
          <div>
            <Label>Name (Optional)</Label>
            <Input
              value={boardName}
              onChange={(e) => setBoardName(e.target.value)}
              placeholder="My expression board"
              className="mt-1"
            />
          </div>

          {/* Expressions Preview */}
          <div>
            <Label>Expressions ({getTotalExpressions()} total)</Label>
            <div className="mt-2 space-y-2">
              {selectedBoardTypes.map((boardType) => (
                <div key={boardType}>
                  <p className="text-xs font-medium text-muted-foreground mb-1">
                    {BOARD_TYPE_LABELS[boardType]}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {BOARD_EXPRESSIONS[boardType].map((expression) => (
                      <span
                        key={expression}
                        className="px-2 py-0.5 text-xs bg-muted rounded-md"
                      >
                        {expression}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Cost & Create */}
          <div className="flex items-center justify-between pt-4 border-t">
            <div className="text-sm text-muted-foreground">
              Estimated cost: <span className="font-medium">${getEstimatedCost()}</span>
              <span className="ml-2">({getTotalExpressions()} expressions)</span>
            </div>
            <Button onClick={handleCreate} disabled={!canCreate() || creating}>
              {creating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Creating...
                </>
              ) : (
                <>
                  <Palette className="h-4 w-4 mr-2" />
                  Generate Expression Board
                </>
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* Boards Gallery */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Your Expression Boards</h2>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : boards.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center border rounded-lg">
            <Palette className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium">No expression boards yet</h3>
            <p className="text-muted-foreground mt-1">
              Create your first expression board using the form above
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
                      alt={board.name || 'Expression Board'}
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
                          <p className="text-xs text-muted-foreground mt-1">
                            {board.expressions.length} expressions
                          </p>
                        </div>
                      ) : board.status === 'failed' ? (
                        <div className="text-center px-4">
                          <p className="text-sm text-destructive">
                            {board.error_message || 'Generation failed'}
                          </p>
                        </div>
                      ) : (
                        <Palette className="h-12 w-12 text-muted-foreground" />
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
                        <span>{board.expressions.length} expressions</span>
                        <span className={getStatusColor(board.status)}>
                          {board.status}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {board.board_types.map((type) => (
                          <span
                            key={type}
                            className="px-1.5 py-0.5 text-xs bg-muted rounded"
                          >
                            {BOARD_TYPE_LABELS[type]}
                          </span>
                        ))}
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
                        {(board.status === 'generating' || board.status === 'pending') && (
                          <DropdownMenuItem
                            className="text-yellow-600"
                            onClick={() => handleCancel(board.id)}
                          >
                            <XCircle className="h-4 w-4 mr-2" />
                            Cancel
                          </DropdownMenuItem>
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
        <DialogContent className="max-w-6xl max-h-[90vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>{previewBoard?.name || 'Expression Board'}</DialogTitle>
            <DialogDescription>
              {previewBoard?.expressions.length} expressions across {previewBoard?.board_types.length} categories
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-center bg-muted rounded-lg overflow-hidden">
            {previewBoard?.board_url && (
              <img
                src={previewBoard.board_url}
                alt={previewBoard.name || 'Expression Board'}
                className="max-h-[70vh] object-contain"
              />
            )}
          </div>
          {previewBoard?.subject_profile && (
            <div className="mt-4 p-4 bg-muted rounded-lg">
              <h4 className="font-medium mb-2">Subject Profile</h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                <div><span className="text-muted-foreground">Age:</span> {previewBoard.subject_profile.ageDesc}</div>
                <div><span className="text-muted-foreground">Gender:</span> {previewBoard.subject_profile.gender}</div>
                <div><span className="text-muted-foreground">Hair:</span> {previewBoard.subject_profile.hairColor}</div>
                <div><span className="text-muted-foreground">Eyes:</span> {previewBoard.subject_profile.eyeColor}</div>
              </div>
            </div>
          )}
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
