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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Video,
  Upload,
  Plus,
  FolderPlus,
  MoreVertical,
  Trash2,
  Pencil,
  Loader2,
  Play,
  Clock,
  HardDrive,
} from 'lucide-react';
import { videosApi, collectionsApi, filesApi, Collection, Video as VideoType } from '@/lib/api';

export default function VideosPage() {
  const [videos, setVideos] = useState<VideoType[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [selectedCollection, setSelectedCollection] = useState<string>('all');
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
        selectedCollection === 'all'
          ? videosApi.list({ type: 'source' })
          : videosApi.list({ collectionId: selectedCollection }),
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

    if (selectedCollection === 'all') {
      alert('Please select a collection first');
      return;
    }

    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        // Upload file to storage
        const uploaded = await filesApi.uploadFile(file, 'source-videos');

        // Create video record
        await videosApi.create({
          name: file.name.replace(/\.[^/.]+$/, ''),
          collectionId: selectedCollection,
          fileUrl: uploaded.url,
          fileSizeBytes: file.size,
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
    if (!confirm(`Delete collection "${collection.name}"? Videos will be preserved.`)) return;

    try {
      await collectionsApi.delete(collection.id);
      if (selectedCollection === collection.id) {
        setSelectedCollection('all');
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

  const formatDuration = (seconds: number | null) => {
    if (!seconds) return '--:--';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatFileSize = (bytes: number | null) => {
    if (!bytes) return '--';
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="flex-1 space-y-6 p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Videos</h1>
          <p className="text-muted-foreground">
            Manage your video collections for the Variant Generator
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setCreateCollectionOpen(true)}>
            <FolderPlus className="mr-2 h-4 w-4" />
            New Collection
          </Button>
          <div className="relative">
            <input
              type="file"
              accept="video/*"
              multiple
              onChange={handleFileUpload}
              disabled={uploading || selectedCollection === 'all'}
              className="absolute inset-0 opacity-0 cursor-pointer disabled:cursor-not-allowed"
            />
            <Button disabled={uploading || selectedCollection === 'all'}>
              {uploading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Upload className="mr-2 h-4 w-4" />
              )}
              {uploading ? 'Uploading...' : 'Upload Videos'}
            </Button>
          </div>
        </div>
      </div>

      {/* Collection selector */}
      <div className="flex items-center gap-4">
        <Select value={selectedCollection} onValueChange={setSelectedCollection}>
          <SelectTrigger className="w-[250px]">
            <SelectValue placeholder="Select collection" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Videos</SelectItem>
            {collections.map((col) => (
              <SelectItem key={col.id} value={col.id}>
                {col.name} ({col.itemCount || 0})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {selectedCollection !== 'all' && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem
                onClick={() => {
                  const col = collections.find((c) => c.id === selectedCollection);
                  if (col) {
                    setEditingCollection(col);
                    setNewCollectionName(col.name);
                    setEditCollectionOpen(true);
                  }
                }}
              >
                <Pencil className="mr-2 h-4 w-4" />
                Rename Collection
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive"
                onClick={() => {
                  const col = collections.find((c) => c.id === selectedCollection);
                  if (col) handleDeleteCollection(col);
                }}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete Collection
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Videos grid */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : videos.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Video className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">No videos yet</h3>
          <p className="text-muted-foreground mt-1">
            {selectedCollection === 'all'
              ? 'Create a collection and upload videos to get started'
              : 'Upload videos to this collection'}
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
