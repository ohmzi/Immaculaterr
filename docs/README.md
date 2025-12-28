# Tautulli Curated Plex Collection

**Version:** 4.0.0

**Table of Contents**  
- [Overview](#overview)  
- [Architecture & Flow](#architecture--flow)
- [Features](#features)  
- [Requirements](#requirements)  
- [Installation & Setup](#installation--setup)  
  - [1. Prerequisites](#1-prerequisites)  
  - [2. Prepare Your `config.yaml`](#2-prepare-your-configyaml)  
  - [3. Configure Script Execution](#3-configure-script-execution)
  - [4. Build the Docker Image (Optional)](#4-build-the-docker-image-optional)  
  - [5. Set Up Tautulli Automation](#5-set-up-tautulli-automation)
- [Standalone Scripts](#standalone-scripts)
  - [Available Scripts](#available-scripts)
  - [Scheduling Scripts](#scheduling-scripts)
    - [Ubuntu/Linux (Cron)](#ubuntulinux-cron)
    - [Windows Task Scheduler](#windows-task-scheduler)
- [Configuration Options](#configuration-options)
- [Expected Results](#expected-results)
- [Displaying Collections on Plex Home Screen](#displaying-collections-on-plex-home-screen)
- [Project Structure](#project-structure)
- [Version History](#version-history)

---

## Overview

This automation system creates and maintains multiple dynamic Plex collections based on your viewing habits. When you finish watching a movie, the system:

1. **Generates movie recommendations** using OpenAI GPT (with TMDb fallback)
2. **Checks your Plex library** for existing recommendations
3. **Adds missing movies to Radarr** for automatic download
4. **Maintains multiple Plex collections:**
   - **"Based on your recently watched movie"** - Similar recommendations
   - **"Change of Taste"** - Contrasting recommendations  
   - **"Inspired by your Immaculate Taste"** - Curated collection with points system
5. **Cleans up duplicates** in your Plex library
6. **Synchronizes Radarr monitoring** with Plex library status
7. **Refreshes collections** by randomizing order and applying updates to Plex

---

## Architecture & Flow

### Entry Point
The main script `src/tautulli_curated/main.py` (or `tautulli_immaculate_taste_collection.py` for backward compatibility) is triggered by Tautulli when a movie is watched. It accepts two arguments:
- Movie title (from Tautulli)
- Media type (should be "movie")

### Execution Pipeline

The script executes in the following order (each step can be enabled/disabled via config):

#### **Step 1: Recently Watched Collection** (if enabled)
- Generates up to 15 similar movie recommendations using OpenAI
- Generates up to 15 contrasting movie recommendations ("Change of Taste")
- Checks Plex library for each recommendation
- Adds missing movies to Radarr
- Saves recommendations to JSON files:
  - `data/recently_watched_collection.json`
  - `data/change_of_taste_collection.json`

#### **Step 2: Plex Duplicate Cleaner** (if enabled)
- Scans entire Plex library for duplicate movies (by TMDB ID)
- Removes lower quality duplicates based on your preferences
- Unmonitors movies in Radarr after deletion to prevent re-download
- Respects quality preservation settings (e.g., keep 4K files)

#### **Step 3: Radarr Monitor Confirm** (if enabled)
- Checks all monitored movies in Radarr
- Unmonitors movies that already exist in Plex
- Prevents unnecessary downloads and keeps Radarr in sync

#### **Step 4: Immaculate Taste Collection** (if enabled)
- Main recommendation pipeline with points system
- Generates up to 50 recommendations using OpenAI (with TMDb fallback)
- Checks Plex library for each recommendation
- Adds missing movies to Radarr
- Updates points system:
  - New recommendations: +1 point
  - Existing items: points maintained
  - Items with 0 or negative points: removed from collection
- Saves points data to `data/recommendation_points.json`

#### **Step 5: Collection Refreshers** (MANDATORY - if enabled)
These scripts **actually add movies to Plex collections**. Without them, movies are only saved to JSON files but never appear in Plex!

- **Recently Watched Collection Refresher:**
  - Reads `data/recently_watched_collection.json` and `data/change_of_taste_collection.json`
  - Uses rating keys for fast, direct Plex lookups (same as Immaculate Taste refresher)
  - Randomizes movie order
  - Removes all items from both Plex collections
  - Adds all movies back in randomized order
  - Filters out non-movie items (clips, shows, etc.)

- **Immaculate Taste Collection Refresher:**
  - Reads `data/recommendation_points.json`
  - Randomizes movie order
  - Removes all items from the Plex collection
  - Adds all movies back in randomized order

**Note:** These refreshers are **mandatory by default** (`true`) because they apply the collections to Plex. You can set them to `false` to run independently during off-peak hours.

---

## Features

### **Dual Collection System**
- **Recently Watched Collections:**
  - "Based on your recently watched movie" - Movies similar to what you just watched
  - "Change of Taste" - Movies that offer a different experience (palate cleanser)
  
- **Immaculate Taste Collection:**
  - Curated collection with intelligent points system
  - Maintains relevance over time
  - Prioritizes high-quality recommendations

### **GPT Recommendations**
- Uses OpenAI GPT to generate intelligent movie suggestions
- Includes mix of mainstream, indie, international, and arthouse films
- TMDb fallback if OpenAI is unavailable
- Configurable recommendation counts per collection

### **Plex Integration**
- Server-side search for fast lookups
- Normalizes titles for accurate matching
- Maintains multiple dedicated collections
- Automatic duplicate detection and cleanup

### **Radarr Automation**
- Adds missing movies to Radarr automatically
- Uses TMDb ID for accurate matching
- Configurable root folder, quality profile, and tags
- Automatically triggers search for newly added movies
- Monitors/unmonitors movies based on Plex library status
- **Optional Overseerr Integration:** For users who want manual approval before movies are downloaded, you can use the modified Overseerr fork that allows admins to approve their own requests: [https://github.com/ohmzi/overseerr](https://github.com/ohmzi/overseerr) (Note: The original Overseerr doesn't allow admins to approve their own requests)

### **Points System** (Immaculate Taste Collection)
- New recommendations get +1 point per run
- Points persist across runs
- Collection maintains all movies with their current points
- Automatic cleanup of items with 0 or negative points

### **Duplicate Management**
- Scans entire library for duplicate movies
- Removes duplicates based on quality preferences
- Preserves high-quality files (configurable)
- Unmonitors in Radarr after deletion

### **Radarr Synchronization**
- Keeps Radarr monitoring status in sync with Plex
- Unmonitors movies already in Plex
- Prevents unnecessary downloads

### **Collection Refreshers**
- **MANDATORY** - These actually add movies to Plex!
- Randomizes collection order for fresh presentation
- Can run automatically or independently during off-peak hours
- Handles large collections gracefully
- Filters non-movie items automatically
- **Custom Artwork:** Automatically sets custom posters and backgrounds for collections

### **YAML Configuration**
- All settings in one place (`config/config.yaml`)
- Script execution control at the top
- Clear documentation and examples
- Type-safe configuration with dataclasses

### **Structured Logging**
- Step-based logging with timing information
- Clear execution flow visibility
- Detailed error messages and troubleshooting
- Summary statistics for each script

---

## Requirements

1. **Core Services:**
   - Plex Media Server
   - Tautulli
   - Radarr (for automatic movie downloads)
   - **Overseerr (Optional):** For manual approval workflow before movies are downloaded. Use the modified fork: [https://github.com/ohmzi/overseerr](https://github.com/ohmzi/overseerr) - The original Overseerr doesn't allow admins to approve their own requests.

2. **APIs:**
   - OpenAI API Key (required for recommendations)
   - TMDb API Key (required, used as fallback and for movie lookups)

3. **Python Dependencies:**
   - `requests` (for API calls)
   - `PyYAML` (for configuration)
   - `plexapi` (for Plex integration)
   - `openai` (for GPT recommendations)

---

## Installation & Setup

### 1. Prerequisites

- **Plex, Tautulli, and Radarr** must already be installed and working.
- You'll need valid credentials for each service (tokens, API keys, etc.).

### 2. Prepare Your `config.yaml`

1. Create or edit `config/config.yaml` in the project with your real credentials:

```yaml
# ============================================================================
# SCRIPT EXECUTION CONTROL
# ============================================================================
scripts_run:
  run_recently_watched_collection: true    # Step 1: Recently Watched Collection
  run_plex_duplicate_cleaner: true         # Step 2: Plex Duplicate Cleaner
  run_radarr_monitor_confirm_plex: true    # Step 3: Radarr Monitor Confirm
  run_immaculate_taste_collection: true    # Step 4: Immaculate Taste Collection
  run_recently_watched_refresher: true     # Step 5a: Recently Watched Collections Refresher (MANDATORY)
  run_collection_refresher: true           # Step 5b: Immaculate Taste Refresher (MANDATORY)

# ============================================================================
# PLEX CONFIGURATION
# ============================================================================
plex:
  url: "http://localhost:32400"
  token: "YOUR_PLEX_TOKEN"
  movie_library_name: "Movies"
  collection_name: "Inspired by your Immaculate Taste"
  delete_preference: "largest_file"  # Options: smallest_file, largest_file, newest, oldest
  preserve_quality: []                # Example: ["4K", "1080p"] to preserve high quality

# ============================================================================
# OPENAI CONFIGURATION
# ============================================================================
openai:
  api_key: "sk-proj-XXXXXXXXXXXXXXXXXXX"
  recommendation_count: 50

# ============================================================================
# RADARR CONFIGURATION
# ============================================================================
radarr:
  url: "http://localhost:7878"
  api_key: "YOUR_RADARR_API_KEY"
  root_folder: "/path/to/Movies"
  tag_name: "recommended"
  quality_profile_id: 1

# ============================================================================
# TMDB CONFIGURATION
# ============================================================================
tmdb:
  api_key: "YOUR_TMDB_API_KEY"
  recommendation_count: 50

# ============================================================================
# FILE PATHS
# ============================================================================
files:
  points_file: "recommendation_points.json"
  tmdb_cache_file: "tmdb_cache.json"
```

2. Make sure `config/config.yaml` is accessible to your scripts (either in the project directory or mounted as a volume in Docker).

### 3. Configure Script Execution

All scripts can be enabled or disabled via the `scripts_run` section in `config/config.yaml`. The execution order is:

1. **Recently Watched Collection** - Generates recommendations for two collections (similar + contrasting)
2. **Plex Duplicate Cleaner** - Removes duplicate movies
3. **Radarr Monitor Confirm** - Syncs Radarr monitoring with Plex
4. **Immaculate Taste Collection** - Main recommendation pipeline
5. **Collection Refreshers** - **MANDATORY** - These add movies to Plex!

**Important:** The collection refreshers are **mandatory by default** (`true`) because they actually apply the collections to Plex. Without them, movies are saved to JSON but never added to Plex collections.

**Option A: Run Refreshers Automatically (Recommended)**
- Set both `run_recently_watched_refresher: true` and `run_collection_refresher: true`
- Collections are updated immediately after recommendations are generated
- Best for most users

**Option B: Run Refreshers Independently (For Large Collections)**
- Set both refreshers to `false` in config
- Run them separately during off-peak hours:
  ```bash
  # Recently Watched Collections
  ./src/scripts/run_recently_watched_collections_refresher.sh --no-pause
  
  # Immaculate Taste Collection
  ./src/scripts/run_immaculate_taste_refresher.sh --no-pause
  ```
- Schedule via cron for automatic execution:
  ```bash
  # Run at midnight every day
  0 0 * * * /path/to/project/src/scripts/run_recently_watched_collections_refresher.sh --no-pause
  0 0 * * * /path/to/project/src/scripts/run_immaculate_taste_refresher.sh --no-pause
  ```
- Recommended for collections with 1000+ items (reordering can take 1-2 hours)

**Bash Script Options:**
- `--dry-run`: Show what would be done without actually updating Plex
- `--verbose`: Enable debug-level logging
- `--no-pause`: Don't pause at the end (for automated runs)
- `--log-file`: Also save output to a log file with timestamp
- `--help`: Show help message

### 4. Build the Docker Image (Optional)

If you're using Docker, build the custom Tautulli image:

```bash
docker build -f docker/custom-tautulli/Dockerfile -t tautulli_recommendations .
```

Then update your Tautulli container to use this image. Ensure `config/config.yaml` and `data/` directory are mounted as volumes.

### 5. Set Up Tautulli Automation

#### Main Script Setup

To have Tautulli automatically call your script whenever someone finishes watching a movie:

1. Open Tautulli → Settings → Notification Agents.
2. Click Add a new notification agent and choose **Script**.
3. **Script Folder**: Browse to the folder where the script is located (e.g., `/path/to/project/src/tautulli_curated` or the mounted volume path).
4. **Script File**: Select `main.py` (or `tautulli_immaculate_taste_collection.py` for backward compatibility).
5. **Description**: Provide a friendly name (e.g., "Tautulli Curated Collection Script").
6. **Trigger**: Choose **Watched** (so the script runs when a user finishes watching a movie).
7. **Arguments**: Under Watched arguments, pass:
   ```bash
   "{title}" "{media_type}"
   ```
   This passes both the movie title and media type to the script.
8. **Test Notification**:  
   Click Test → select your script → provide `"Inception (2010)"` as the first argument and `movie` as the second argument.
9. **Verify**:  
   Check Tautulli's logs to see if the script ran successfully and view the output.

---

## Configuration Options

### Script Execution Control

All scripts can be enabled/disabled individually:

| Option | Default | Description |
|--------|---------|-------------|
| `run_recently_watched_collection` | `true` | Step 1: Generate recommendations for "Recently Watched" and "Change of Taste" collections |
| `run_plex_duplicate_cleaner` | `true` | Step 2: Scan and remove duplicate movies from Plex |
| `run_radarr_monitor_confirm_plex` | `true` | Step 3: Unmonitor movies in Radarr that are already in Plex |
| `run_immaculate_taste_collection` | `true` | Step 4: Main recommendation pipeline with points system |
| `run_recently_watched_refresher` | `true` | Step 5a: Apply Recently Watched collections to Plex (MANDATORY) |
| `run_collection_refresher` | `true` | Step 5b: Apply Immaculate Taste collection to Plex (MANDATORY) |

### Plex Configuration

- `url`: Your Plex server URL (e.g., `http://localhost:32400`)
- `token`: Your Plex authentication token
- `movie_library_name`: Name of your Plex movie library
- `collection_name`: Name of the main collection ("Inspired by your Immaculate Taste")
- `delete_preference`: Which duplicate file to delete (`smallest_file`, `largest_file`, `newest`, `oldest`)
- `preserve_quality`: List of quality keywords to preserve (e.g., `["4K", "1080p"]`)

### OpenAI Configuration

- `api_key`: Your OpenAI API key
- `recommendation_count`: Number of recommendations per run (default: 50)

### Radarr Configuration

- `url`: Your Radarr server URL
- `api_key`: Your Radarr API key
- `root_folder`: Root folder for movie downloads
- `tag_name`: Tag to apply to added movies
- `quality_profile_id`: Quality profile ID (default: 1)

**Optional: Overseerr Integration**
- If you prefer manual approval before movies are downloaded, you can use Overseerr instead of direct Radarr integration
- **Important:** Use the modified fork [https://github.com/ohmzi/overseerr](https://github.com/ohmzi/overseerr) which allows admins to approve their own requests
- The original Overseerr doesn't support admin self-approval, so this fork is required for the approval workflow

### TMDb Configuration

- `api_key`: Your TMDb API key
- `recommendation_count`: Number of recommendations from TMDb (default: 50)

---

## Expected Results

### After Each Movie Watch

When you finish watching a movie, you can expect:

1. **Recently Watched Collections Updated:**
   - "Based on your recently watched movie" collection gets new similar recommendations
   - "Change of Taste" collection gets new contrasting recommendations
   - Both collections are randomized and updated in Plex (if refresher enabled)

2. **Immaculate Taste Collection Updated:**
   - New recommendations added to the collection
   - Points system updated (new items get +1 point)
   - Collection randomized and updated in Plex (if refresher enabled)

3. **Missing Movies Added to Radarr:**
   - Movies not in Plex are automatically added to Radarr
   - Search is triggered automatically
   - Movies are tagged appropriately

4. **Duplicates Cleaned (if enabled):**
   - Lower quality duplicates removed from Plex
   - Radarr unmonitored for deleted duplicates

5. **Radarr Synchronized (if enabled):**
   - Movies already in Plex are unmonitored in Radarr
   - Prevents unnecessary downloads

### Log Output Example

```
TAUTULLI CURATED COLLECTION SCRIPTS START
Movie: Inception
Media type: movie

Script Execution Configuration:
  ✓ Recently Watched Collection: ENABLED
  ✓ Plex Duplicate Cleaner: ENABLED
  ✓ Radarr Monitor Confirm: ENABLED
  ✓ Immaculate Taste Collection: ENABLED
  ✓ Recently Watched Refresher: ENABLED
  ✓ Immaculate Taste Refresher: ENABLED

Execution Order:
  1. Recently Watched Collection (if enabled)
  2. Plex Duplicate Cleaner (if enabled)
  3. Radarr Monitor Confirm (if enabled)
  4. Immaculate Taste Collection (if enabled)
  5. Collection Refreshers (if enabled)

[Scripts execute...]

TAUTULLI CURATED COLLECTION SCRIPTS SUMMARY
Execution Summary:
  - Recently Watched Collection: ✓ Completed
  - Plex Duplicate Cleaner: ✓ Completed
  - Radarr Monitor Confirm: ✓ Completed
  - Immaculate Taste Collection: ✓ Completed
  - Collection Refreshers: ✓ Completed
Total execution time: 45.3 seconds
TAUTULLI CURATED COLLECTION SCRIPTS END OK
```

### Collection Sizes

- **Recently Watched Collections:** Typically 15-30 movies each (refreshed each run)
- **Immaculate Taste Collection:** Grows over time, maintains all movies with points > 0
- Collections are automatically randomized on each refresh for fresh presentation

### Data Files

All data is stored in the `data/` directory:

- `recommendation_points.json` - Points system for Immaculate Taste collection (dict with rating keys as keys)
- `recently_watched_collection.json` - Recently Watched collection data (list of dicts with `title`, `rating_key`, and `year`)
- `change_of_taste_collection.json` - Change of Taste collection data (list of dicts with `title`, `rating_key`, and `year`)
- `tmdb_cache.json` - TMDb API cache (reduces API calls)
- `logs/` - Optional log files from bash scripts

**JSON Structure Examples:**
- **Recently Watched/Change of Taste collections:**
  ```json
  [
    {
      "title": "Movie Title",
      "rating_key": "12345",
      "year": 2020
    }
  ]
  ```
- **Immaculate Taste collection (points system):**
  ```json
  {
    "12345": {"points": 5, "title": "Movie Title"},
    "67890": {"points": 3, "title": "Another Movie"}
  }
  ```

**Note:** Rating keys enable faster Plex lookups and more reliable movie identification. The refresher scripts prioritize rating key lookups over title searches for better performance.

### Collection Artwork

Custom posters and backgrounds for collections are stored in `assets/collection_artwork/`:

- **Posters:** `assets/collection_artwork/posters/` - Collection poster images (recommended: 1000x1500px, 2:3 aspect ratio)
- **Backgrounds:** `assets/collection_artwork/backgrounds/` - Collection background images (recommended: 1920x1080px or larger, 16:9 aspect ratio)

**Supported Collections:**
- `immaculate_taste_collection.png` - For "Inspired by your Immaculate Taste" collection
- `recently_watched_collection.png` - For "Based on your recently watched movie" collection
- `change_of_taste_collection.png` - For "Change of Taste" collection

**File Formats:** PNG or JPG (both supported)

**Automatic Application:**
- Artwork is automatically uploaded to Plex when collections are created or updated
- If artwork files are not found, collections will use Plex's default artwork
- Artwork upload failures are non-critical and won't stop collection updates

See `assets/collection_artwork/README.md` for detailed information.

---

## Displaying Collections on Plex Home Screen

To make your curated collections visible on the Plex home screen and control their display order, follow these steps:

#### Step 1: Make Collections Visible on Home

For each collection you want to display:

1. **Navigate to your Movies library** in Plex
2. **Go to the Collections view** (click "Collections" in the library navigation)
3. **Find your collection** (e.g., "Inspired by your Immaculate Taste", "Based on your recently watched movie", or "Change of Taste")
4. **Hover over the collection** and click the **three-dot menu** (⋯)
5. **Select "Visible On"** from the menu
6. **Check both options:**
   - ✅ **Home** - Makes the collection appear on your home screen
   - ✅ **Library** - Makes the collection visible in the library view

Repeat this process for all three collections you want to display.

#### Step 2: Make Collections Visible in Library

While you're in the Collections view:

1. For each collection, click the **three-dot menu** (⋯) again
2. Select **"Visible On"**
3. Ensure **"Library"** is checked (you may have already done this in Step 1)

#### Step 3: Manage Collection Order in Recommendations

To control the order in which collections appear on your home screen:

1. **Open Plex Settings** (click your profile icon → Settings)
2. **Navigate to "Library"** in the left sidebar (under "Manage")
3. **Scroll down** and find the **"Manage Recommendations"** section
4. **Click the dropdown** to expand "Manage Recommendations"
5. **Find your three collections** in the list:
   - "Inspired by your Immaculate Taste"
   - "Based on your recently watched movie"
   - "Change of Taste"
6. **Drag and drop** each collection to move them to the **top of the list**
   - Collections at the top appear first on your home screen
   - Collections at the bottom appear later or may require scrolling

**Recommended Order:**
1. "Based on your recently watched movie" (most dynamic, changes frequently)
2. "Change of Taste" (complementary to recently watched)
3. "Inspired by your Immaculate Taste" (curated collection, larger and more stable)

#### Step 4: Verify on Home Screen

1. **Navigate to your Plex Home screen**
2. **Scroll down** to find your collections
3. Collections should appear as rows with their custom artwork (if you've added artwork)
4. Collections will update automatically as the scripts run

**Note:** It may take a few moments for changes to appear. If collections don't show up immediately, try refreshing your Plex client or waiting a minute for the changes to propagate.

**Troubleshooting:**
- If collections don't appear, ensure they have at least one movie in them
- Check that "Visible On → Home" is enabled for each collection
- Verify the collection order in Settings → Library → Manage Recommendations
- Make sure you're viewing the correct Plex server (if you have multiple servers)

---

## Project Structure

```
Tautulli_Curated_Plex_Collection/
├── assets/
│   └── collection_artwork/                 # Custom collection artwork
│       ├── posters/                        # Collection poster images
│       │   ├── immaculate_taste_collection.png
│       │   ├── recently_watched_collection.png
│       │   └── change_of_taste_collection.png
│       ├── backgrounds/                    # Collection background images
│       │   ├── immaculate_taste_collection.png
│       │   ├── recently_watched_collection.png
│       │   └── change_of_taste_collection.png
│       └── README.md                       # Artwork documentation
├── config/
│   └── config.yaml                         # Configuration file (user-friendly structure)
├── data/                                    # Generated data files
│   ├── recommendation_points.json          # Points system data
│   ├── recently_watched_collection.json     # Recently Watched collection data
│   ├── change_of_taste_collection.json     # Change of Taste collection data
│   ├── tmdb_cache.json                      # TMDb API cache
│   └── logs/                                # Log files (optional)
├── src/
│   ├── tautulli_curated/                   # Main Python package
│   │   ├── __init__.py
│   │   ├── main.py                          # Main entry point (orchestrates all scripts)
│   │   └── helpers/                         # Shared helper modules (used by all scripts)
│   │       ├── immaculate_taste_refresher.py    # Immaculate Taste Collection Refresher
│   │       ├── recently_watched_collection.py   # Recently Watched Collection script
│   │       ├── recently_watched_collections_refresher.py  # Recently Watched Collections Refresher
│   │       └── ... (other helper modules)
│   │       ├── pipeline_recent_watch.py     # Main pipeline orchestration
│   │       ├── config_loader.py             # YAML config loader
│   │       ├── logger.py                    # Logging setup
│   │       ├── change_of_taste_collection.py # Change of Taste collection logic
│   │       ├── plex_duplicate_cleaner.py    # Duplicate cleaner
│   │       ├── radarr_monitor_confirm.py     # Radarr monitor confirmation
│   │       ├── unmonitor_radarr_after_download.py  # Unmonitor helper
│   │       ├── plex_collection_manager.py    # Collection management
│   │       ├── plex_search.py               # Plex movie search
│   │       ├── radarr_utils.py              # Radarr integration
│   │       ├── chatgpt_utils.py             # OpenAI integration
│   │       ├── recommender.py               # Recommendation orchestrator
│   │       ├── tmdb_recommender.py          # TMDb recommendation engine
│   │       ├── tmdb_cache.py                # TMDb caching layer
│   │       └── tmdb_client.py               # Basic TMDb API client
│   └── scripts/                             # Executable bash scripts
│       ├── run_immaculate_taste_refresher.sh         # Immaculate Taste Refresher runner
│       ├── run_recently_watched_collections_refresher.sh  # Recently Watched Collections Refresher runner
│       ├── run_radarr_monitor_confirm.sh    # Radarr Monitor Confirm runner
│       └── run_radarr_search_monitored.sh   # Trigger Radarr search for monitored movies
├── docker/
│   └── custom-tautulli/                    # Docker configuration
│       ├── Dockerfile                       # Custom Tautulli image
│       ├── docker-compose.yml               # Docker Compose config
│       └── requirements.txt                 # Python dependencies
├── docs/
│   └── README.md                           # This file
├── requirements.txt                         # Python dependencies
├── tautulli_immaculate_taste_collection.py  # Backward-compatible entry point
└── sample_run_pictures/                     # Screenshots and examples
```

---

## Standalone Scripts

The project includes several standalone bash scripts that can be run independently of the main Tautulli-triggered workflow. These scripts are located in `src/scripts/` and can be scheduled to run automatically or executed manually as needed.

### Available Scripts

#### 1. `run_recently_watched_collections_refresher.sh`
**Purpose:** Refreshes the "Based on your recently watched movie" and "Change of Taste" Plex collections.

**What it does:**
- Reads `data/recently_watched_collection.json` and `data/change_of_taste_collection.json`
- Uses rating keys for fast, direct Plex API lookups (same optimization as Immaculate Taste refresher)
- Randomizes the order of movies in each collection
- Removes all existing items from both Plex collections
- Adds all movies back in randomized order
- Filters out non-movie items (clips, shows, etc.)
- Falls back to title search if rating key is missing or invalid (backward compatible)

**When to use:**
- Run independently if `run_recently_watched_refresher` is set to `false` in config
- Schedule during off-peak hours for large collections
- Manually refresh collections without waiting for a movie watch event

**Usage:**
```bash
./src/scripts/run_recently_watched_collections_refresher.sh [options]
```

**Options:**
- `--dry-run`: Show what would be done without actually updating Plex
- `--verbose`: Enable debug-level logging
- `--no-pause`: Don't pause at the end (for automated runs)
- `--log-file`: Save output to a timestamped log file in `data/logs/`
- `--help`: Show help message

**Example:**
```bash
# Run with verbose logging and save to log file
./src/scripts/run_recently_watched_collections_refresher.sh --verbose --log-file --no-pause
```

---

#### 2. `run_immaculate_taste_refresher.sh`
**Purpose:** Refreshes the "Inspired by your Immaculate Taste" Plex collection.

**What it does:**
- Reads `data/recommendation_points.json`
- Uses rating keys for fast, direct Plex API lookups
- Randomizes the order of movies based on their points
- Removes all existing items from the Plex collection
- Adds all movies back in randomized order
- Filters out non-movie items automatically

**When to use:**
- Run independently if `run_collection_refresher` is set to `false` in config
- Schedule during off-peak hours (this can take 1-2 hours for large collections with 1000+ items)
- Manually refresh the collection without waiting for a movie watch event

**Usage:**
```bash
./src/scripts/run_immaculate_taste_refresher.sh [options]
```

**Options:**
- `--dry-run`: Show what would be done without actually updating Plex
- `--verbose`: Enable debug-level logging
- `--no-pause`: Don't pause at the end (for automated runs)
- `--log-file`: Save output to a timestamped log file in `data/logs/`
- `--help`: Show help message

**Example:**
```bash
# Run in dry-run mode to see what would happen
./src/scripts/run_immaculate_taste_refresher.sh --dry-run

# Run with logging for scheduled execution
./src/scripts/run_immaculate_taste_refresher.sh --no-pause --log-file
```

---

#### 3. `run_radarr_monitor_confirm.sh`
**Purpose:** Checks all monitored movies in Radarr and unmonitors those that already exist in your Plex library.

**What it does:**
- Gets all monitored movies from Radarr
- Gets all TMDB IDs from your Plex library
- Compares them and finds movies that are monitored in Radarr but already in Plex
- Unmonitors those movies in Radarr (unless `--dry-run` is used)
- Provides summary statistics

**When to use:**
- Run periodically to keep Radarr and Plex synchronized
- Schedule via cron for routine maintenance
- After bulk imports to Plex
- As part of a maintenance routine

**Usage:**
```bash
./src/scripts/run_radarr_monitor_confirm.sh [options]
```

**Options:**
- `--dry-run`: Show what would be done without actually unmonitoring
- `--no-pause`: Don't pause at the end (for automated runs)
- `--help`: Show help message

**Example:**
```bash
# Normal run (will actually unmonitor)
./src/scripts/run_radarr_monitor_confirm.sh

# Dry run (see what would happen)
./src/scripts/run_radarr_monitor_confirm.sh --dry-run

# For automated/scheduled runs
./src/scripts/run_radarr_monitor_confirm.sh --no-pause
```

---

#### 4. `run_radarr_search_monitored.sh`
**Purpose:** Triggers a search for all monitored movies in Radarr.

**What it does:**
- Connects to Radarr using credentials from `config/config.yaml`
- Sends a command to Radarr to search for all monitored movies
- Useful for forcing Radarr to check for available releases

**When to use:**
- Periodically trigger searches for monitored movies that haven't been downloaded yet
- After adding new movies to Radarr (though the main script does this automatically)
- As part of a maintenance routine to ensure Radarr is actively searching

**Usage:**
```bash
./src/scripts/run_radarr_search_monitored.sh [options]
```

**Options:**
- `--help`: Show help message

**Requirements:**
- `yq` must be installed (for reading YAML config)
  - Ubuntu/Debian: `sudo apt-get install yq`
  - macOS: `brew install yq`
- `curl` must be installed (usually pre-installed)

**Example:**
```bash
# Trigger search for all monitored movies
./src/scripts/run_radarr_search_monitored.sh
```

**Note:** This script reads Radarr configuration from `config/config.yaml`. Make sure your Radarr URL and API key are correctly configured.

---

### Scheduling Scripts

These standalone scripts can be scheduled to run automatically using cron (Linux/Ubuntu) or Windows Task Scheduler. This is especially useful for:

- Running collection refreshers during off-peak hours (midnight, early morning)
- Periodically triggering Radarr searches
- Automating maintenance tasks

#### Ubuntu/Linux (Cron)

**Step 1: Open your crontab**
```bash
crontab -e
```

**Step 2: Add cron jobs**

Here are example cron entries for each script:

```bash
# Run Recently Watched Collections Refresher every day at 2:00 AM
0 2 * * * /path/to/Tautulli_Curated_Plex_Collection/src/scripts/run_recently_watched_collections_refresher.sh --no-pause --log-file >> /dev/null 2>&1

# Run Immaculate Taste Collection Refresher every day at 3:00 AM (runs after Recently Watched)
0 3 * * * /path/to/Tautulli_Curated_Plex_Collection/src/scripts/run_immaculate_taste_refresher.sh --no-pause --log-file >> /dev/null 2>&1

# Trigger Radarr search for monitored movies every 6 hours
0 */6 * * * /path/to/Tautulli_Curated_Plex_Collection/src/scripts/run_radarr_search_monitored.sh >> /dev/null 2>&1
```

**Important Notes:**
- Replace `/path/to/Tautulli_Curated_Plex_Collection` with your actual project path
- Use absolute paths (not relative paths) in cron
- The `--no-pause` flag prevents scripts from waiting for user input
- The `--log-file` flag saves output to timestamped log files in `data/logs/`
- `>> /dev/null 2>&1` suppresses email notifications (remove if you want email alerts)

**Cron Schedule Format:**
```
* * * * * command
│ │ │ │ │
│ │ │ │ └─── Day of week (0-7, Sunday = 0 or 7)
│ │ │ └───── Month (1-12)
│ │ └─────── Day of month (1-31)
│ └───────── Hour (0-23)
└─────────── Minute (0-59)
```

**Common Examples:**
```bash
# Every day at midnight
0 0 * * * /path/to/script.sh

# Every 6 hours
0 */6 * * * /path/to/script.sh

# Every Monday at 2:00 AM
0 2 * * 1 /path/to/script.sh

# Every day at 2:00 AM and 2:00 PM
0 2,14 * * * /path/to/script.sh
```

**Step 3: Verify cron is running**
```bash
# Check if cron service is running
sudo systemctl status cron

# View cron logs (Ubuntu/Debian)
grep CRON /var/log/syslog

# View your cron jobs
crontab -l
```

---

#### Windows Task Scheduler

**Step 1: Open Task Scheduler**
- Press `Win + R`, type `taskschd.msc`, and press Enter
- Or search for "Task Scheduler" in the Start menu

**Step 2: Create a Basic Task**

1. Click **"Create Basic Task"** in the right panel
2. **Name:** Give it a descriptive name (e.g., "Refresh Recently Watched Collections")
3. **Description:** Optional description
4. Click **Next**

**Step 3: Set Trigger**

Choose when to run:
- **Daily:** Run every day at a specific time
- **Weekly:** Run on specific days of the week
- **Monthly:** Run on specific days of the month
- **When the computer starts:** Run at startup
- **When I log on:** Run when you log in

For example, select **"Daily"** and set time to **2:00 AM**, then click **Next**

**Step 4: Set Action**

1. Select **"Start a program"**
2. Click **Next**
3. **Program/script:** Enter the full path to your script:
   ```
   C:\path\to\Tautulli_Curated_Plex_Collection\src\scripts\run_recently_watched_collections_refresher.sh
   ```
   
   **Note:** If you're using Git Bash or WSL, you may need to use:
   ```
   C:\Program Files\Git\bin\bash.exe
   ```
   
   And add arguments:
   ```
   C:\path\to\Tautulli_Curated_Plex_Collection\src\scripts\run_recently_watched_collections_refresher.sh --no-pause --log-file
   ```

4. **Start in (optional):** Set to your project directory:
   ```
   C:\path\to\Tautulli_Curated_Plex_Collection
   ```

5. Click **Next**

**Step 5: Review and Finish**

1. Review your settings
2. Check **"Open the Properties dialog for this task when I click Finish"**
3. Click **Finish**

**Step 6: Configure Advanced Settings**

In the Properties dialog:

1. **General Tab:**
   - Check **"Run whether user is logged on or not"** (if you want it to run in background)
   - Select **"Run with highest privileges"** (if needed)
   - Configure for: **Windows 10** (or your OS version)

2. **Actions Tab:**
   - Verify the script path is correct
   - Add arguments if needed: `--no-pause --log-file`

3. **Conditions Tab:**
   - Uncheck **"Start the task only if the computer is on AC power"** (if you want it to run on battery)
   - Configure other conditions as needed

4. **Settings Tab:**
   - Check **"Allow task to be run on demand"**
   - Check **"Run task as soon as possible after a scheduled start is missed"**
   - Configure retry options if desired

5. Click **OK**

**Step 7: Test the Task**

1. Right-click your task in the Task Scheduler Library
2. Select **"Run"**
3. Check the **"History"** tab to see if it ran successfully

**Alternative: Using PowerShell Script Wrapper**

If bash scripts don't work directly, create a PowerShell wrapper:

1. Create a file `run_refresher.ps1`:
   ```powershell
   # Change to project directory
   Set-Location "C:\path\to\Tautulli_Curated_Plex_Collection"
   
   # Run the bash script
   & "C:\Program Files\Git\bin\bash.exe" "src/scripts/run_immaculate_taste_refresher.sh" --no-pause --log-file
   ```

2. In Task Scheduler, set:
   - **Program/script:** `powershell.exe`
   - **Arguments:** `-ExecutionPolicy Bypass -File "C:\path\to\run_refresher.ps1"`

**Tips:**
- Test scripts manually before scheduling
- Check Windows Event Viewer for task execution logs
- Use `--log-file` flag to save output to files
- Ensure Python and all dependencies are in PATH

---

## Version History

### Version 4.2.0 (Current)

**Performance Improvements:**
- **Rating Key Optimization:** Recently Watched and Change of Taste collections now use rating keys for faster Plex lookups
- **Consistent Logic:** Both refresher scripts now use the same efficient rating key lookup method
- **Faster Collection Updates:** Direct Plex API calls using rating keys instead of slower title searches
- **Better Progress Tracking:** Improved progress logging every 100 items (similar to Immaculate Taste refresher)

**JSON Structure Enhancements:**
- **Rating Keys in JSON:** All collection JSON files now include rating keys for faster lookups
- **Backward Compatible:** Refresher scripts still support old JSON format (title-only) with automatic fallback
- **Improved Reliability:** Rating keys provide unique identifiers, reducing false matches

**File Organization:**
- **Scripts Moved to Helpers:** Collection scripts moved to `src/tautulli_curated/helpers/` for better organization:
  - `immaculate_taste_refresher.py` → `helpers/immaculate_taste_refresher.py`
  - `recently_watched_collection.py` → `helpers/recently_watched_collection.py`
  - `recently_watched_collections_refresher.py` → `helpers/recently_watched_collections_refresher.py`
- **Updated Imports:** All Python imports updated to reflect new file locations
- **Updated Bash Scripts:** All shell scripts updated with correct file paths

**Code Improvements:**
- **Shared Helper Functions:** Refresher scripts now use shared `_fetch_by_rating_key` from `plex_collection_manager.py`
- **Better Error Handling:** Improved logging for failed/filtered items with rating key information
- **Consistent Patterns:** Both refreshers follow the same code patterns for maintainability

### Version 4.1.0

**New Standalone Script:**
- **`run_radarr_monitor_confirm.sh`:** New standalone script for bulk Radarr/Plex synchronization
  - Checks all monitored movies in Radarr against Plex library
  - Unmonitors movies that already exist in Plex
  - Supports `--dry-run` mode for testing
  - Can be scheduled for routine maintenance
  - Provides detailed summary statistics

**Script Improvements:**
- **Removed `run_unmonitor_radarr.sh`:** Consolidated functionality into the main pipeline
  - The underlying Python helper (`unmonitor_radarr_after_download.py`) remains available for internal use
  - Bulk synchronization is now handled by `run_radarr_monitor_confirm.sh`
- **Enhanced Script Pause Functionality:** All standalone scripts now pause at the end by default
  - Users can review logs before terminal closes
  - `--no-pause` option available for automated runs
  - Better user experience for manual execution

**Documentation Enhancements:**
- **Plex Home Screen Setup Guide:** New comprehensive section with step-by-step instructions
  - How to make collections visible on home and library views
  - How to manage collection order in Plex Settings → Library → Manage Recommendations
  - Recommended collection order for best user experience
  - Troubleshooting tips for common issues
- **Overseerr Fork Documentation:** Enhanced documentation about the modified Overseerr fork
  - Added to multiple sections (Features, Requirements, Configuration Options)
  - Clear explanation of why the fork is needed (admin self-approval limitation)
  - Direct links to the fork repository: [https://github.com/ohmzi/overseerr](https://github.com/ohmzi/overseerr)
- **Standalone Scripts Documentation:** Updated documentation for all standalone scripts
  - Complete usage examples and options
  - Scheduling instructions for cron and Windows Task Scheduler
  - Clear explanations of when and why to use each script

**Improvements:**
- Better error handling and logging across all scripts
- Improved script usability with pause functionality
- More comprehensive documentation for setup and configuration

### Version 4.0.0

**Major System Overhaul:**
- **Unified Project:** Merged Recently Watched Collection and Immaculate Taste Collection into a single, cohesive system
- **Multi-Collection Support:** Maintains 3 Plex collections simultaneously:
  - "Based on your recently watched movie" - Similar recommendations
  - "Change of Taste" - Contrasting recommendations
  - "Inspired by your Immaculate Taste" - Curated collection with points system
- **Script Orchestration:** Main script (`main.py`) orchestrates all sub-scripts in proper execution order
- **Comprehensive Error Handling:** Added retry logic with exponential backoff for all API calls
- **Improved Reliability:** Better handling of network issues, timeouts, and API errors

**New Features:**
- **Recently Watched Collections:** Two new collections based on recently watched movies
- **Change of Taste Collection:** Palate cleanser recommendations (contrasting genres/themes)
- **Plex Duplicate Cleaner:** Integrated duplicate detection and removal
- **Radarr Monitor Confirm:** Automatic synchronization of Radarr monitoring with Plex library
- **Custom Collection Artwork:** Automatic upload of custom posters and backgrounds for collections
- **Standalone Scripts:** Four independent bash scripts for scheduled execution:
  - `run_recently_watched_collections_refresher.sh` - Refresh Recently Watched collections
  - `run_immaculate_taste_refresher.sh` - Refresh Immaculate Taste collection
  - `run_radarr_monitor_confirm.sh` - Sync Radarr monitoring with Plex library
  - `run_radarr_search_monitored.sh` - Trigger Radarr search for all monitored movies

**Error Handling & Reliability:**
- **Retry Logic:** Comprehensive retry mechanism with exponential backoff (`retry_utils.py`)
- **HTTPError Detection:** Improved error handling for HTTP 400/500 errors
  - 400 Bad Request errors correctly identified as non-retryable
  - 5xx server errors retried with exponential backoff
  - Network/timeout errors automatically retried
- **Connection Resilience:** All Plex and Radarr API calls use retry logic
- **Error Recovery:** Scripts continue execution even if individual operations fail

**Configuration:**
- User-friendly config file structure with script execution control at the top
- All scripts can be enabled/disabled individually
- Mandatory refreshers by default (they add movies to Plex!)
- Clear documentation and examples

**Logging & Debugging:**
- Enhanced logging across all scripts for better troubleshooting
- Improved error messages with context
- Standardized logger names for easier log filtering
- Better progress indicators for long-running operations

**Scripts:**
- Recently Watched Collection script (Step 1)
- Plex Duplicate Cleaner (Step 2)
- Radarr Monitor Confirm (Step 3)
- Immaculate Taste Collection script (Step 4)
- Collection Refreshers (Step 5 - MANDATORY)

**Documentation:**
- Comprehensive section on standalone scripts
- Scheduling instructions for Ubuntu/Linux (cron) and Windows Task Scheduler
- Complete version history

**New Feature - Custom Collection Artwork:**
- **Automatic Artwork Upload:** Collections can now have custom posters and backgrounds
- **Artwork Location:** Images stored in `assets/collection_artwork/` directory
- **Supported Collections:** All three collections support custom artwork
- **Automatic Application:** Artwork is uploaded when collections are created or updated
- **Non-Critical:** Artwork upload failures don't stop collection updates

**Bug Fixes:**
- Fixed `NameError: name 'cfg' is not defined` in `recently_watched_collections_refresher.py`
- Fixed unnecessary retries for HTTP 400 errors in Radarr operations
- Improved collection update error handling
- Better handling of non-movie items (clips, shows) in collections

### Version 3.0.0

**Professional Project Structure:**
- Reorganized into `src/`, `config/`, `data/`, `docker/`, and `docs/` directories
- Proper Python package structure with `tautulli_curated` package
- All imports updated to use package structure
- Better separation of concerns

**New Features:**
- **Collection Refresher:** Independent script (`immaculate_taste_refresher.py`) for randomizing and refreshing collection order
- **Bash Script Wrapper:** `src/scripts/run_immaculate_taste_refresher.sh` with options for:
  - Dry-run mode
  - Verbose logging
  - Log file output
  - No-pause mode for automated runs

**Configuration:**
- Added `run_collection_refresher` configuration option
- Collection refresher can run as part of main script or independently
- Enhanced logging throughout scripts

**Improvements:**
- Enhanced logging with clear start/end markers
- Better error handling and connection timeout management
- Improved decision explanations in logs
- TMDb fallback recommendations
- Points system for collection management

**Code Quality:**
- Modular helper structure
- Type-safe configuration with dataclasses
- Better code organization and maintainability

### Version 2.0.0

**Major Refactoring:**
- **Modular Architecture:** Split monolithic script into organized helper modules
- **Professional Structure:** Introduced `helpers/` directory with specialized modules:
  - `config_loader.py` - YAML configuration loader with dataclasses
  - `logger.py` - Structured logging setup
  - `pipeline_recent_watch.py` - Main pipeline orchestration
  - `recommender.py` - Recommendation orchestrator
  - `chatgpt_utils.py` - OpenAI integration
  - `tmdb_recommender.py` - TMDb recommendation engine
  - `tmdb_cache.py` - TMDb caching layer
  - `tmdb_client.py` - Basic TMDb API client
  - `plex_search.py` - Plex movie search
  - `plex_collection_manager.py` - Collection management
  - `radarr_utils.py` - Radarr integration
  - `run_context.py` - Step tracking context

**New Features:**
- **TMDb Fallback:** Advanced TMDb recommendation system as fallback when OpenAI fails
- **Structured Logging:** Step-based logging with timing information
- **Type-Safe Configuration:** Configuration loaded into dataclasses for better validation
- **Better Error Handling:** Improved error messages and recovery

**Improvements:**
- Better code organization and maintainability
- Reduced code duplication
- More testable code structure
- Enhanced documentation

**Removed:**
- Removed `plex_duplicate_cleaner.py` (moved to separate project)
- Removed `radarr_plex_monitor.py` (integrated into main pipeline)

### Version 1.0.0

**Initial Release:**
- **Core Functionality:** Single script (`tautulli_watched_movies.py`) with all features
- **OpenAI Recommendations:** GPT-based movie recommendations (up to 50 movies)
- **Plex Integration:** 
  - Search Plex library for recommended movies
  - Maintain dynamic collection ("Inspired by your Immaculate Taste")
  - Duplicate detection and cleanup
- **Radarr Automation:**
  - Add missing movies to Radarr
  - Unmonitor movies already in Plex
  - Configurable root folder, quality profile, and tags
- **Overseerr Support:**
  - Submit recommendations for manual approval
  - Configurable root folders and quality profiles
  - **Note:** The original Overseerr doesn't allow admins to approve their own requests. For proper approval workflow, use the modified fork: [https://github.com/ohmzi/overseerr](https://github.com/ohmzi/overseerr)
- **Points System:**
  - New recommendations: +10 points
  - Existing items: -1 point per run
  - Movies need ≥5 points OR TMDb rating >8 to remain in collection
  - Points persisted in JSON file
- **TMDb Integration:**
  - TMDb API for movie lookups
  - Caching of TMDb IDs and ratings
  - Rating-based collection filtering
- **YAML Configuration:** All settings in `config.yaml`
- **Docker Support:** Custom Tautulli Docker image with dependencies
- **Basic Logging:** Simple logging setup

**Key Features:**
- Episode detection (prevents running on TV shows)
- Cache clearing functionality
- Configurable permissions for cleaner and unmonitor operations
- Basic error handling

**Limitations:**
- Monolithic code structure (all in one file)
- No fallback if OpenAI fails
- Basic error handling
- Limited logging and debugging capabilities

**Error Handling & Reliability Improvements:**
- **Retry Logic:** Added comprehensive retry mechanism with exponential backoff (`retry_utils.py`)
- **HTTPError Detection:** Improved error handling for HTTP 400/500 errors
  - 400 Bad Request errors are now correctly identified as non-retryable
  - 5xx server errors are retried with exponential backoff
  - Network/timeout errors are automatically retried
- **Connection Resilience:** All Plex and Radarr API calls now use retry logic
- **Error Recovery:** Scripts continue execution even if individual operations fail

**New Standalone Script:**
- **`run_radarr_search_monitored.sh`:** Triggers search for all monitored movies in Radarr
  - Useful for periodic maintenance
  - Reads configuration from `config/config.yaml`
  - Requires `yq` and `curl`

**Logging & Debugging:**
- Enhanced logging across all scripts for better troubleshooting
- Improved error messages with context
- Standardized logger names for easier log filtering
- Better progress indicators for long-running operations

**Bug Fixes:**
- Fixed `NameError: name 'cfg' is not defined` in `recently_watched_collections_refresher.py`
- Fixed unnecessary retries for HTTP 400 errors in Radarr operations
- Improved collection update error handling

**Documentation:**
- Added comprehensive section on standalone scripts
- Added scheduling instructions for Ubuntu/Linux (cron) and Windows Task Scheduler
- Updated project structure documentation

---

**Now whenever Tautulli detects that a user has finished watching a movie, it will trigger your script with the movie's title. The system will generate recommendations, update collections, clean duplicates, sync Radarr, and refresh your Plex collections automatically.**

**Tip: Add the collections to your Home screen and position them at the very top—right beneath the Continue Watching list.**

**Enjoy using this script! I hope it enhances your movie selection. If you encounter any issues or have ideas for enhancements, feel free to open an issue or submit a pull request.**

---

## License

This project is provided "as is" without warranty of any kind. You are free to use, modify, and distribute this code as per the [MIT License](https://opensource.org/licenses/MIT).
