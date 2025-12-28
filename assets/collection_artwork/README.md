# Collection Artwork

This directory contains custom artwork (posters and backgrounds) for Plex collections.

## Directory Structure

```
collection_artwork/
├── posters/          # Collection poster images
│   ├── immaculate_taste_collection.png
│   ├── recently_watched_collection.png
│   └── change_of_taste_collection.png
└── backgrounds/    # Collection background images
    ├── immaculate_taste_collection.png
    ├── recently_watched_collection.png
    └── change_of_taste_collection.png
```

## Collection Artwork Files

### Immaculate Taste Collection
- **Poster:** `posters/immaculate_taste_collection.png`
- **Background:** `backgrounds/immaculate_taste_collection.png`
- **Collection Name:** "Inspired by your Immaculate Taste"

### Recently Watched Collection
- **Poster:** `posters/recently_watched_collection.png`
- **Background:** `backgrounds/recently_watched_collection.png`
- **Collection Name:** "Based on your recently watched movie"

### Change of Taste Collection
- **Poster:** `posters/change_of_taste_collection.png`
- **Background:** `backgrounds/change_of_taste_collection.png`
- **Collection Name:** "Change of Taste"

## Image Requirements

- **Format:** PNG or JPG
- **Poster Size:** Recommended 1000x1500px (2:3 aspect ratio)
- **Background Size:** Recommended 1920x1080px (16:9 aspect ratio) or larger
- **File Size:** Keep under 5MB per image for best performance

## Usage

The artwork is automatically applied when collections are created or updated by the scripts. The system will:
1. Check if artwork files exist for each collection
2. Upload the poster image to Plex when the collection is created/updated
3. Upload the background image to Plex when the collection is created/updated

If artwork files are not found, the collections will use Plex's default artwork.

