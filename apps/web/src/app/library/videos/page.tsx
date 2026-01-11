'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Video,
  Upload,
  FolderPlus,
  Folder,
  FolderOpen,
  MoreVertical,
  Trash2,
  Pencil,
  Loader2,
  Play,
  Clock,
  HardDrive,
  ArrowLeft,
  Inbox,
  Sparkles,
  FolderInput,
  CheckSquare,
  Square,
} from 'lucide-react';
import { videosApi, collectionsApi, filesApi, Collection, Video as VideoType } from '@/lib/api';
import { extractVideoMetadata, formatDuration, formatFileSize } from '@/lib/video-utils';

type ViewMode = 'collections' | 'all' | 'generated' | 'collection';

export default function VideosPage() {
  const [videos, setVideos] = useState<VideoType[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [selectedCollection, setSelectedCollection] = useState<Collection | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('collections');
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  // Video counts
  const [allCount, setAllCount] = useState(0);
  const [generatedCount, setGeneratedCount] = useState(0);

  // Selection state
  const [selectedVideos, setSelectedVideos] = useState<Set<string>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);

  // Dialog states
  const [createCollectionOpen, setCreateCollectionOpen] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [editCollectionOpen, setEditCollectionOpen] = useState(false);
  const [editingCollection, setEditingCollection] = useState<Collection | null>(null);
  const [deleteVideoOpen, setDeleteVideoOpen] = useState(false);
  const [deletingVideo, setDeletingVideo] = useState<VideoType | null>(null);
  const [videoPreviewOpen, setVideoPreviewOpen] = useState(false);
  const [previewVideo, setPreviewVideo] = useState<VideoType | null>(null);
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [moveNewCollectionName, setMoveNewCollectionName] = useState('');
  const [showCreateInMove, setShowCreateInMove] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      // Always load collections and counts
      const [collectionsData, allCountData, generatedCountData] = await Promise.all([
        collectionsApi.list('video'),
        videosApi.count(),
        videosApi.count({ uncategorized: true }),
      ]);
      setCollections(collectionsData);
      setAllCount(allCountData.count);
      setGeneratedCount(generatedCountData.count);

      // Load videos based on view mode
      let videosData: VideoType[] = [];
      if (viewMode === 'all') {
        videosData = await videosApi.list();
      } else if (viewMode === 'generated') {
        videosData = await videosApi.list({ uncategorized: true });
      } else if (viewMode === 'collection' && selectedCollection) {
        videosData = await videosApi.list({ collectionId: selectedCollection.id });
      }
      setVideos(videosData);
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  }, [viewMode, selectedCollection]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Clear selection when changing views
  useEffect(() => {
    setSelectedVideos(new Set());
    setSelectionMode(false);
  }, [viewMode, selectedCollection]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    if (!selectedCollection) {
      alert('Please select a collection first');
      return;
    }

    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        let metadata: { duration: number; width: number; height: number; thumbnailBlob: Blob | null } | null = null;
        try {
          metadata = await extractVideoMetadata(file);
        } catch (metadataError) {
          console.warn('Failed to extract video metadata:', metadataError);
        }

        const uploaded = await filesApi.uploadFile(file, 'source-videos');

        let thumbnailUrl: string | undefined;
        if (metadata?.thumbnailBlob) {
          try {
            const thumbnailFile = new File(
              [metadata.thumbnailBlob],
              `${file.name.replace(/\.[^/.]+$/, '')}_thumb.jpg`,
              { type: 'image/jpeg' }
            );
            const thumbnailUploaded = await filesApi.uploadFile(thumbnailFile, 'source-videos');
            thumbnailUrl = thumbnailUploaded.url;
          } catch (thumbError) {
            console.warn('Failed to upload thumbnail:', thumbError);
          }
        }

        await videosApi.create({
          name: file.name.replace(/\.[^/.]+$/, ''),
          collectionId: selectedCollection.id,
          fileUrl: uploaded.url,
          fileSizeBytes: file.size,
          durationSeconds: metadata?.duration,
          width: metadata?.width,
          height: metadata?.height,
          thumbnailUrl,
        });
      }
      await loadData();
    } catch (error) {
      console.error('Upload failed:', error);
      alert('Failed to upload video');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleCreateCollection = async () => {
    if (!newCollectionName.trim()) return;

    try {
      const newCollection = await collectionsApi.create({
        name: newCollectionName.trim(),
        type: 'video',
      });
      setNewCollectionName('');
      setCreateCollectionOpen(false);
      await loadData();
      // Optionally navigate to the new collection
      setSelectedCollection(newCollection);
      setViewMode('collection');
    } catch (error) {
      console.error('Failed to create collection:', error);
      alert('Failed to create collection');
    }
  };

  const handleUpdateCollection = async () => {
    if (!editingCollection || !newCollectionName.trim()) return;

    try {
      await collectionsApi.update(editingCollection.id, newCollectionName.trim());
      setEditCollectionOpen(false);
      setEditingCollection(null);
      setNewCollectionName('');
      await loadData();
    } catch (error) {
      console.error('Failed to update collection:', error);
      alert('Failed to update collection');
    }
  };

  const handleDeleteCollection = async (collection: Collection) => {
    if (!confirm(`Delete collection "${collection.name}"? Videos will be moved to Generated.`)) return;

    try {
      await collectionsApi.delete(collection.id);
      if (selectedCollection?.id === collection.id) {
        setSelectedCollection(null);
        setViewMode('collections');
      }
      await loadData();
    } catch (error) {
      console.error('Failed to delete collection:', error);
      alert('Failed to delete collection');
    }
  };

  const handleDeleteVideo = async () => {
    if (!deletingVideo) return;

    try {
      await videosApi.delete(deletingVideo.id);
      setDeleteVideoOpen(false);
      setDeletingVideo(null);
      await loadData();
    } catch (error) {
      console.error('Failed to delete video:', error);
      alert('Failed to delete video');
    }
  };

  const handleDeleteSelected = async () => {
    if (selectedVideos.size === 0) return;
    if (!confirm(`Delete ${selectedVideos.size} selected video(s)? This cannot be undone.`)) return;

    try {
      for (const id of selectedVideos) {
        await videosApi.delete(id);
      }
      setSelectedVideos(new Set());
      setSelectionMode(false);
      await loadData();
    } catch (error) {
      console.error('Failed to delete videos:', error);
      alert('Failed to delete some videos');
    }
  };

  const handleMoveToCollection = async (collectionId: string | null) => {
    if (selectedVideos.size === 0) return;

    try {
      await videosApi.move(Array.from(selectedVideos), collectionId);
      setSelectedVideos(new Set());
      setSelectionMode(false);
      setMoveDialogOpen(false);
      await loadData();
    } catch (error) {
      console.error('Failed to move videos:', error);
      alert('Failed to move videos');
    }
  };

  const handleCreateAndMove = async () => {
    if (!moveNewCollectionName.trim() || selectedVideos.size === 0) return;

    try {
      const newCollection = await collectionsApi.create({
        name: moveNewCollectionName.trim(),
        type: 'video',
      });
      await videosApi.move(Array.from(selectedVideos), newCollection.id);
      setSelectedVideos(new Set());
      setSelectionMode(false);
      setMoveDialogOpen(false);
      setMoveNewCollectionName('');
      setShowCreateInMove(false);
      await loadData();
    } catch (error) {
      console.error('Failed to create collection and move:', error);
      alert('Failed to create collection');
    }
  };

  const toggleVideoSelection = (videoId: string) => {
    const newSelection = new Set(selectedVideos);
    if (newSelection.has(videoId)) {
      newSelection.delete(videoId);
    } else {
      newSelection.add(videoId);
    }
    setSelectedVideos(newSelection);
  };

  const selectAllVideos = () => {
    setSelectedVideos(new Set(videos.map(v => v.id)));
  };

  const deselectAllVideos = () => {
    setSelectedVideos(new Set());
  };

  const getVideoTypeBadge = (type: string) => {
    if (type === 'face_swapped') {
      return <Badge variant="secondary" className="text-xs"><Sparkles className="h-3 w-3 mr-1" />AI Swap</Badge>;
    }
    if (type === 'variant') {
      return <Badge variant="outline" className="text-xs">Variant</Badge>;
    }
    return null;
  };

  const renderCollectionsList = () => (
    <div className="space-y-6">
      {/* Quick Access */}
      <div>
        <h3 className="text-sm font-medium text-muted-foreground mb-3">Quick Access</h3>
        <div className="grid gap-3 md:grid-cols-2">
          <button
            onClick={() => setViewMode('all')}
            className="flex items-center gap-3 p-4 rounded-lg border bg-card hover:shadow-md transition-all text-left"
          >
            <div className="p-2 rounded-lg bg-blue-500/10">
              <Video className="h-6 w-6 text-blue-500" />
            </div>
            <div>
              <h3 className="font-medium">All Videos</h3>
              <p className="text-sm text-muted-foreground">{allCount} video{allCount !== 1 ? 's' : ''}</p>
            </div>
          </button>

          <button
            onClick={() => setViewMode('generated')}
            className="flex items-center gap-3 p-4 rounded-lg border bg-card hover:shadow-md transition-all text-left"
          >
            <div className="p-2 rounded-lg bg-purple-500/10">
              <Sparkles className="h-6 w-6 text-purple-500" />
            </div>
            <div>
              <h3 className="font-medium">Generated</h3>
              <p className="text-sm text-muted-foreground">{generatedCount} video{generatedCount !== 1 ? 's' : ''}</p>
            </div>
          </button>
        </div>
      </div>

      {/* Collections */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-muted-foreground">Collections</h3>
          <Button size="sm" variant="ghost" onClick={() => setCreateCollectionOpen(true)}>
            <FolderPlus className="h-4 w-4 mr-1" />
            New
          </Button>
        </div>

        {collections.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center border rounded-lg">
            <Folder className="h-10 w-10 text-muted-foreground mb-3" />
            <p className="text-muted-foreground">No collections yet</p>
            <Button className="mt-3" variant="outline" size="sm" onClick={() => setCreateCollectionOpen(true)}>
              Create First Collection
            </Button>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {collections.map((collection) => (
              <div
                key={collection.id}
                className="group relative rounded-lg border bg-card p-4 hover:shadow-md transition-all cursor-pointer hover:border-primary"
                onClick={() => {
                  setSelectedCollection(collection);
                  setViewMode('collection');
                }}
              >
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-primary/10">
                    <FolderOpen className="h-6 w-6 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium truncate">{collection.name}</h3>
                    <p className="text-sm text-muted-foreground mt-1">
                      {collection.itemCount} video{collection.itemCount !== 1 ? 's' : ''}
                    </p>
                  </div>
                </div>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingCollection(collection);
                        setNewCollectionName(collection.name);
                        setEditCollectionOpen(true);
                      }}
                    >
                      <Pencil className="mr-2 h-4 w-4" />
                      Rename
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteCollection(collection);
                      }}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  const renderVideosGrid = () => (
    <div className="space-y-4">
      {/* Selection toolbar */}
      {selectionMode && (
        <div className="flex items-center gap-3 p-3 bg-muted rounded-lg">
          <span className="text-sm font-medium">{selectedVideos.size} selected</span>
          <Button size="sm" variant="ghost" onClick={selectAllVideos}>
            Select All ({videos.length})
          </Button>
          <Button size="sm" variant="ghost" onClick={deselectAllVideos}>
            Clear
          </Button>
          <div className="flex-1" />
          <Button size="sm" variant="outline" onClick={() => setMoveDialogOpen(true)} disabled={selectedVideos.size === 0}>
            <FolderInput className="h-4 w-4 mr-2" />
            Move to Collection
          </Button>
          <Button size="sm" variant="destructive" onClick={handleDeleteSelected} disabled={selectedVideos.size === 0}>
            <Trash2 className="h-4 w-4 mr-2" />
            Delete
          </Button>
        </div>
      )}

      {videos.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Video className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">No videos yet</h3>
          <p className="text-muted-foreground mt-1">
            {viewMode === 'generated'
              ? 'Videos from AI Swapper will appear here'
              : 'Upload videos to this collection'}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {videos.map((video) => (
            <div
              key={video.id}
              className={`group relative rounded-lg border bg-card overflow-hidden hover:shadow-md transition-shadow ${
                selectedVideos.has(video.id) ? 'ring-2 ring-primary' : ''
              }`}
            >
              {/* Selection checkbox */}
              {selectionMode && (
                <div
                  className="absolute top-2 left-2 z-10"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleVideoSelection(video.id);
                  }}
                >
                  <Checkbox
                    checked={selectedVideos.has(video.id)}
                    className="bg-white/80"
                  />
                </div>
              )}

              {/* Video thumbnail */}
              <div
                className="aspect-video bg-muted flex items-center justify-center cursor-pointer relative"
                onClick={() => {
                  if (selectionMode) {
                    toggleVideoSelection(video.id);
                  } else {
                    setPreviewVideo(video);
                    setVideoPreviewOpen(true);
                  }
                }}
              >
                {video.thumbnail_url ? (
                  <img
                    src={video.thumbnail_url}
                    alt={video.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <Video className="h-12 w-12 text-muted-foreground" />
                )}
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <Play className="h-12 w-12 text-white" />
                </div>
              </div>

              {/* Video info */}
              <div className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-medium truncate flex-1">{video.name}</h3>
                  {getVideoTypeBadge(video.type)}
                </div>
                <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {formatDuration(video.duration_seconds)}
                  </span>
                  <span className="flex items-center gap-1">
                    <HardDrive className="h-3 w-3" />
                    {formatFileSize(video.file_size_bytes)}
                  </span>
                </div>
              </div>

              {/* Actions dropdown */}
              {!selectionMode && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-black/50 hover:bg-black/70 text-white"
                    >
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem
                      onClick={() => {
                        setSelectedVideos(new Set([video.id]));
                        setMoveDialogOpen(true);
                      }}
                    >
                      <FolderInput className="mr-2 h-4 w-4" />
                      Move to Collection
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="text-destructive"
                      onClick={() => {
                        setDeletingVideo(video);
                        setDeleteVideoOpen(true);
                      }}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const getTitle = () => {
    if (viewMode === 'all') return 'All Videos';
    if (viewMode === 'generated') return 'Generated Videos';
    if (viewMode === 'collection' && selectedCollection) return selectedCollection.name;
    return 'Video Collections';
  };

  const getSubtitle = () => {
    if (viewMode === 'all') return `${videos.length} video${videos.length !== 1 ? 's' : ''} total`;
    if (viewMode === 'generated') return `${videos.length} video${videos.length !== 1 ? 's' : ''} from AI Swapper`;
    if (viewMode === 'collection') return `${videos.length} video${videos.length !== 1 ? 's' : ''} in this collection`;
    return 'Organize your videos into collections';
  };

  return (
    <div className="flex-1 space-y-6 p-8">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          {viewMode !== 'collections' && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                setSelectedCollection(null);
                setViewMode('collections');
              }}
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
          )}
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{getTitle()}</h1>
            <p className="text-muted-foreground">{getSubtitle()}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {viewMode !== 'collections' && (
            <>
              <Button
                variant={selectionMode ? 'secondary' : 'outline'}
                size="sm"
                onClick={() => {
                  setSelectionMode(!selectionMode);
                  if (selectionMode) setSelectedVideos(new Set());
                }}
              >
                {selectionMode ? <CheckSquare className="h-4 w-4 mr-2" /> : <Square className="h-4 w-4 mr-2" />}
                {selectionMode ? 'Done' : 'Select'}
              </Button>
              {viewMode === 'collection' && (
                <>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="icon">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={() => {
                          if (selectedCollection) {
                            setEditingCollection(selectedCollection);
                            setNewCollectionName(selectedCollection.name);
                            setEditCollectionOpen(true);
                          }
                        }}
                      >
                        <Pencil className="mr-2 h-4 w-4" />
                        Rename Collection
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={() => selectedCollection && handleDeleteCollection(selectedCollection)}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete Collection
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <div className="relative">
                    <input
                      type="file"
                      accept="video/*"
                      multiple
                      onChange={handleFileUpload}
                      disabled={uploading}
                      className="absolute inset-0 opacity-0 cursor-pointer disabled:cursor-not-allowed"
                    />
                    <Button disabled={uploading}>
                      {uploading ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Upload className="mr-2 h-4 w-4" />
                      )}
                      {uploading ? 'Uploading...' : 'Upload Videos'}
                    </Button>
                  </div>
                </>
              )}
            </>
          )}
          {viewMode === 'collections' && (
            <Button onClick={() => setCreateCollectionOpen(true)}>
              <FolderPlus className="mr-2 h-4 w-4" />
              New Collection
            </Button>
          )}
        </div>
      </div>

      {/* Main content */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : viewMode === 'collections' ? (
        renderCollectionsList()
      ) : (
        renderVideosGrid()
      )}

      {/* Create Collection Dialog */}
      <Dialog open={createCollectionOpen} onOpenChange={setCreateCollectionOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Video Collection</DialogTitle>
            <DialogDescription>
              Create a new collection to organize your videos.
            </DialogDescription>
          </DialogHeader>
          <Input
            placeholder="Collection name"
            value={newCollectionName}
            onChange={(e) => setNewCollectionName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreateCollection()}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateCollectionOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateCollection}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Collection Dialog */}
      <Dialog open={editCollectionOpen} onOpenChange={setEditCollectionOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Collection</DialogTitle>
          </DialogHeader>
          <Input
            placeholder="Collection name"
            value={newCollectionName}
            onChange={(e) => setNewCollectionName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleUpdateCollection()}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditCollectionOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleUpdateCollection}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Video Confirmation */}
      <Dialog open={deleteVideoOpen} onOpenChange={setDeleteVideoOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Video</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &quot;{deletingVideo?.name}&quot;? This action cannot
              be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteVideoOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteVideo}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Move to Collection Dialog */}
      <Dialog open={moveDialogOpen} onOpenChange={(open) => {
        setMoveDialogOpen(open);
        if (!open) {
          setShowCreateInMove(false);
          setMoveNewCollectionName('');
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move to Collection</DialogTitle>
            <DialogDescription>
              Move {selectedVideos.size} video{selectedVideos.size !== 1 ? 's' : ''} to a collection.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 max-h-64 overflow-y-auto">
            <button
              className="w-full text-left p-3 hover:bg-muted rounded-lg flex items-center gap-2"
              onClick={() => handleMoveToCollection(null)}
            >
              <Inbox className="h-4 w-4 text-muted-foreground" />
              <span>Generated (Uncategorized)</span>
            </button>

            {collections.map((col) => (
              <button
                key={col.id}
                className="w-full text-left p-3 hover:bg-muted rounded-lg flex items-center gap-2"
                onClick={() => handleMoveToCollection(col.id)}
              >
                <Folder className="h-4 w-4 text-muted-foreground" />
                <span>{col.name}</span>
                <span className="text-xs text-muted-foreground ml-auto">{col.itemCount} videos</span>
              </button>
            ))}
          </div>

          <div className="border-t pt-4">
            {showCreateInMove ? (
              <div className="flex gap-2">
                <Input
                  placeholder="New collection name"
                  value={moveNewCollectionName}
                  onChange={(e) => setMoveNewCollectionName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreateAndMove()}
                />
                <Button onClick={handleCreateAndMove} disabled={!moveNewCollectionName.trim()}>
                  Create & Move
                </Button>
              </div>
            ) : (
              <Button variant="outline" className="w-full" onClick={() => setShowCreateInMove(true)}>
                <FolderPlus className="h-4 w-4 mr-2" />
                Create New Collection
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Video Preview Dialog */}
      <Dialog open={videoPreviewOpen} onOpenChange={setVideoPreviewOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{previewVideo?.name}</DialogTitle>
          </DialogHeader>
          <div className="aspect-video bg-black rounded-lg overflow-hidden">
            {previewVideo && (
              <video
                src={previewVideo.file_url}
                controls
                autoPlay
                className="w-full h-full"
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
