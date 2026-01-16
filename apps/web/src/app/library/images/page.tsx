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
  Image as ImageIcon,
  MoreVertical,
  Trash2,
  Loader2,
  ExternalLink,
  Plus,
  FolderOpen,
  Sparkles,
  User,
  Images,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  imageCollectionsApi,
  type ImageCollection,
  type ImageItem,
} from '@/lib/api';
import Link from 'next/link';

export default function ImagesPage() {
  // Collections state
  const [collections, setCollections] = useState<ImageCollection[]>([]);
  const [activeCollection, setActiveCollection] = useState<string>('all');
  const [loadingCollections, setLoadingCollections] = useState(true);

  // Images state
  const [images, setImages] = useState<ImageItem[]>([]);
  const [loadingImages, setLoadingImages] = useState(true);

  // Dialog states
  const [createCollectionOpen, setCreateCollectionOpen] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [creatingCollection, setCreatingCollection] = useState(false);

  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewImage, setPreviewImage] = useState<ImageItem | null>(null);

  // Load collections
  const loadCollections = useCallback(async () => {
    try {
      const data = await imageCollectionsApi.list();
      setCollections(data);
    } catch (error) {
      console.error('Failed to load collections:', error);
    } finally {
      setLoadingCollections(false);
    }
  }, []);

  // Load images for selected collection
  const loadImages = useCallback(async () => {
    setLoadingImages(true);
    try {
      const data = activeCollection === 'all'
        ? await imageCollectionsApi.getAllImages()
        : await imageCollectionsApi.getCollectionImages(activeCollection);
      setImages(data);
    } catch (error) {
      console.error('Failed to load images:', error);
    } finally {
      setLoadingImages(false);
    }
  }, [activeCollection]);

  useEffect(() => {
    loadCollections();
  }, [loadCollections]);

  useEffect(() => {
    loadImages();
    // Poll for updates every 10 seconds
    const interval = setInterval(loadImages, 10000);
    return () => clearInterval(interval);
  }, [loadImages]);

  const handleCreateCollection = async () => {
    if (!newCollectionName.trim()) return;

    setCreatingCollection(true);
    try {
      await imageCollectionsApi.create(newCollectionName.trim());
      setNewCollectionName('');
      setCreateCollectionOpen(false);
      await loadCollections();
    } catch (error) {
      console.error('Failed to create collection:', error);
    } finally {
      setCreatingCollection(false);
    }
  };

  const handleDeleteCollection = async (collectionId: string) => {
    if (!confirm('Delete this collection? Images will not be deleted.')) return;

    try {
      await imageCollectionsApi.delete(collectionId);
      if (activeCollection === collectionId) {
        setActiveCollection('all');
      }
      await loadCollections();
    } catch (error) {
      console.error('Failed to delete collection:', error);
    }
  };

  const getCollectionIcon = (collection: ImageCollection) => {
    if (collection.id === 'smart-character-diagrams') {
      return <User className="h-4 w-4" />;
    }
    if (collection.id === 'smart-generated') {
      return <Sparkles className="h-4 w-4" />;
    }
    return <FolderOpen className="h-4 w-4" />;
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  };

  // Separate smart and custom collections
  const smartCollections = collections.filter((c) => c.type === 'smart');
  const customCollections = collections.filter((c) => c.type === 'custom');

  // Calculate total count
  const totalCount = collections.reduce((sum, c) => sum + c.count, 0);

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <div className="w-64 border-r p-4 flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
            Collections
          </h2>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => setCreateCollectionOpen(true)}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        <nav className="space-y-1 flex-1">
          {/* All Images */}
          <button
            onClick={() => setActiveCollection('all')}
            className={cn(
              'w-full flex items-center justify-between px-3 py-2 rounded-md text-sm transition-colors',
              activeCollection === 'all'
                ? 'bg-muted font-medium'
                : 'hover:bg-muted/50'
            )}
          >
            <span className="flex items-center gap-2">
              <Images className="h-4 w-4" />
              All Images
            </span>
            <span className="text-xs text-muted-foreground">{totalCount}</span>
          </button>

          {/* Smart Collections */}
          {smartCollections.length > 0 && (
            <>
              <div className="pt-4 pb-2">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Smart
                </span>
              </div>
              {smartCollections.map((collection) => (
                <button
                  key={collection.id}
                  onClick={() => setActiveCollection(collection.id)}
                  className={cn(
                    'w-full flex items-center justify-between px-3 py-2 rounded-md text-sm transition-colors',
                    activeCollection === collection.id
                      ? 'bg-muted font-medium'
                      : 'hover:bg-muted/50'
                  )}
                >
                  <span className="flex items-center gap-2">
                    {getCollectionIcon(collection)}
                    {collection.name}
                  </span>
                  <span className="text-xs text-muted-foreground">{collection.count}</span>
                </button>
              ))}
            </>
          )}

          {/* Custom Collections */}
          {customCollections.length > 0 && (
            <>
              <div className="pt-4 pb-2">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Custom
                </span>
              </div>
              {customCollections.map((collection) => (
                <div
                  key={collection.id}
                  className={cn(
                    'group flex items-center justify-between px-3 py-2 rounded-md text-sm transition-colors',
                    activeCollection === collection.id
                      ? 'bg-muted font-medium'
                      : 'hover:bg-muted/50'
                  )}
                >
                  <button
                    onClick={() => setActiveCollection(collection.id)}
                    className="flex-1 flex items-center gap-2 text-left"
                  >
                    {getCollectionIcon(collection)}
                    <span className="truncate">{collection.name}</span>
                  </button>
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-muted-foreground">{collection.count}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 opacity-0 group-hover:opacity-100"
                      onClick={() => handleDeleteCollection(collection.id)}
                    >
                      <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
            </>
          )}

          {/* Create Collection Button */}
          <button
            onClick={() => setCreateCollectionOpen(true)}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-muted/50 transition-colors mt-2"
          >
            <Plus className="h-4 w-4" />
            New Collection
          </button>
        </nav>
      </div>

      {/* Main Content */}
      <div className="flex-1 pl-6 overflow-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">
              {activeCollection === 'all'
                ? 'All Images'
                : collections.find((c) => c.id === activeCollection)?.name || 'Images'}
            </h1>
            <p className="text-sm text-muted-foreground">
              {images.length} image{images.length !== 1 ? 's' : ''}
            </p>
          </div>
          <Button asChild variant="outline">
            <Link href="/characters">
              <ExternalLink className="mr-2 h-4 w-4" />
              Character Diagrams
            </Link>
          </Button>
        </div>

        {/* Images Grid */}
        {loadingImages || loadingCollections ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : images.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <ImageIcon className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium">No images yet</h3>
            <p className="text-muted-foreground mt-1 mb-4">
              {activeCollection === 'all'
                ? 'Generate images or create character diagrams to get started'
                : 'This collection is empty'}
            </p>
            <div className="flex gap-2">
              <Button asChild variant="outline">
                <Link href="/characters">Create Character Diagram</Link>
              </Button>
              <Button asChild>
                <Link href="/image-generator">Generate Images</Link>
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {images.map((image) => (
              <div
                key={image.id}
                className="group relative rounded-lg border bg-card overflow-hidden hover:shadow-md transition-shadow cursor-pointer"
                onClick={() => {
                  setPreviewImage(image);
                  setPreviewOpen(true);
                }}
              >
                {/* Image */}
                <div className="aspect-square bg-muted">
                  <img
                    src={image.thumbnailUrl || image.imageUrl}
                    alt={image.name}
                    className="w-full h-full object-cover"
                  />
                </div>

                {/* Info Overlay */}
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-3 pt-8">
                  <p className="text-white text-sm font-medium truncate">{image.name}</p>
                  <div className="flex items-center gap-2 text-white/70 text-xs">
                    {image.sourceType === 'character_diagram' && (
                      <User className="h-3 w-3" />
                    )}
                    {image.sourceType === 'generated' && (
                      <Sparkles className="h-3 w-3" />
                    )}
                    <span>{formatDate(image.createdAt)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create Collection Dialog */}
      <Dialog open={createCollectionOpen} onOpenChange={setCreateCollectionOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Collection</DialogTitle>
            <DialogDescription>
              Create a new collection to organize your images.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Input
              placeholder="Collection name"
              value={newCollectionName}
              onChange={(e) => setNewCollectionName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleCreateCollection();
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateCollectionOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreateCollection}
              disabled={!newCollectionName.trim() || creatingCollection}
            >
              {creatingCollection ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Image Preview Dialog */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{previewImage?.name}</DialogTitle>
          </DialogHeader>
          <div className="flex items-center justify-center bg-muted rounded-lg overflow-hidden">
            {previewImage && (
              <img
                src={previewImage.imageUrl}
                alt={previewImage.name}
                className="max-h-[70vh] object-contain"
              />
            )}
          </div>
          <div className="flex justify-between items-center text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              {previewImage?.sourceType === 'character_diagram' && (
                <>
                  <User className="h-4 w-4" />
                  <span>Character Diagram</span>
                </>
              )}
              {previewImage?.sourceType === 'generated' && (
                <>
                  <Sparkles className="h-4 w-4" />
                  <span>Generated Image</span>
                </>
              )}
            </div>
            {previewImage && (
              <span>{formatDate(previewImage.createdAt)}</span>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
