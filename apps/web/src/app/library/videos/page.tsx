'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
} from 'lucide-react';
import { videosApi, collectionsApi, filesApi, Collection, Video as VideoType } from '@/lib/api';
import { extractVideoMetadata, formatDuration, formatFileSize } from '@/lib/video-utils';

export default function VideosPage() {
  const [videos, setVideos] = useState<VideoType[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [selectedCollection, setSelectedCollection] = useState<Collection | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  // Dialog states
  const [createCollectionOpen, setCreateCollectionOpen] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [editCollectionOpen, setEditCollectionOpen] = useState(false);
  const [editingCollection, setEditingCollection] = useState<Collection | null>(null);
  const [deleteVideoOpen, setDeleteVideoOpen] = useState(false);
  const [deletingVideo, setDeletingVideo] = useState<VideoType | null>(null);
  const [videoPreviewOpen, setVideoPreviewOpen] = useState(false);
  const [previewVideo, setPreviewVideo] = useState<VideoType | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [videosData, collectionsData] = await Promise.all([
        selectedCollection
          ? videosApi.list({ collectionId: selectedCollection.id })
          : Promise.resolve([]),
        collectionsApi.list('video'),
      ]);
      setVideos(videosData);
      setCollections(collectionsData);
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  }, [selectedCollection]);

  useEffect(() => {
    loadData();
  }, [loadData]);

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
        // Extract video metadata (duration, dimensions, thumbnail)
        let metadata: { duration: number; width: number; height: number; thumbnailBlob: Blob | null } | null = null;
        try {
          metadata = await extractVideoMetadata(file);
        } catch (metadataError) {
          console.warn('Failed to extract video metadata:', metadataError);
          // Continue without metadata
        }

        // Upload video file to storage
        const uploaded = await filesApi.uploadFile(file, 'source-videos');

        // Upload thumbnail if available
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

        // Create video record with metadata
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
      // Reset file input
      e.target.value = '';
    }
  };

  const handleCreateCollection = async () => {
    if (!newCollectionName.trim()) return;

    try {
      await collectionsApi.create({
        name: newCollectionName.trim(),
        type: 'video',
      });
      setNewCollectionName('');
      setCreateCollectionOpen(false);
      await loadData();
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
    if (!confirm(`Delete collection "${collection.name}"? This cannot be undone.`)) return;

    try {
      await collectionsApi.delete(collection.id);
      if (selectedCollection?.id === collection.id) {
        setSelectedCollection(null);
      }
      await loadData();
    } catch (error) {
      console.error('Failed to delete collection:', error);
      alert('Failed to delete collection. Make sure it is empty first.');
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

  return (
    <div className="flex-1 space-y-6 p-8">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          {selectedCollection && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSelectedCollection(null)}
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
          )}
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              {selectedCollection ? selectedCollection.name : 'Video Collections'}
            </h1>
            <p className="text-muted-foreground">
              {selectedCollection
                ? `${videos.length} video${videos.length !== 1 ? 's' : ''} in this collection`
                : 'Organize your videos into collections'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!selectedCollection ? (
            <Button onClick={() => setCreateCollectionOpen(true)}>
              <FolderPlus className="mr-2 h-4 w-4" />
              New Collection
            </Button>
          ) : (
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
                      setEditingCollection(selectedCollection);
                      setNewCollectionName(selectedCollection.name);
                      setEditCollectionOpen(true);
                    }}
                  >
                    <Pencil className="mr-2 h-4 w-4" />
                    Rename Collection
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-destructive"
                    onClick={() => handleDeleteCollection(selectedCollection)}
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
        </div>
      </div>

      {/* Main content */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : !selectedCollection ? (
        /* Collections grid (folder view) */
        collections.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Folder className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium">No collections yet</h3>
            <p className="text-muted-foreground mt-1">
              Create a collection to organize your videos
            </p>
            <Button className="mt-4" onClick={() => setCreateCollectionOpen(true)}>
              <FolderPlus className="mr-2 h-4 w-4" />
              Create First Collection
            </Button>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {collections.map((collection) => (
              <div
                key={collection.id}
                className="group relative rounded-lg border bg-card p-4 hover:shadow-md transition-all cursor-pointer hover:border-primary"
                onClick={() => setSelectedCollection(collection)}
              >
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-primary/10">
                    <FolderOpen className="h-8 w-8 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium truncate">{collection.name}</h3>
                    <p className="text-sm text-muted-foreground mt-1">
                      {collection.itemCount} video{collection.itemCount !== 1 ? 's' : ''}
                    </p>
                  </div>
                </div>

                {/* Actions dropdown */}
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
        )
      ) : (
        /* Videos grid (inside collection) */
        videos.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Video className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium">No videos yet</h3>
            <p className="text-muted-foreground mt-1">
              Upload videos to this collection
            </p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {videos.map((video) => (
              <div
                key={video.id}
                className="group relative rounded-lg border bg-card overflow-hidden hover:shadow-md transition-shadow"
              >
                {/* Video thumbnail / preview */}
                <div
                  className="aspect-video bg-muted flex items-center justify-center cursor-pointer"
                  onClick={() => {
                    setPreviewVideo(video);
                    setVideoPreviewOpen(true);
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
                  <h3 className="font-medium truncate">{video.name}</h3>
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
              </div>
            ))}
          </div>
        )
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
